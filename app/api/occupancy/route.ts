import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { PoolSession } from "@/models/PoolSession";
import { EntryLog } from "@/models/EntryLog";
import { Pool } from "@/models/Pool";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/occupancy
 * Returns:
 *  - current occupancy (sum of active PoolSession.numPersons)
 *  - pool capacity
 *  - 24h hourly history from EntryLog (granted entries, grouped by hour)
 */
export async function GET(req: NextRequest) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        let poolId = session.user.poolId;
        const searchParams = new URL(req.url).searchParams;
        const poolslug = searchParams.get("poolslug");

        // Resolve poolslug to poolId for any role
        if (poolslug) {
            const poolDoc = await Pool.findOne({ slug: poolslug }).select("poolId").lean();
            if (poolDoc) poolId = (poolDoc as any).poolId;
        } else if (session.user.role === "superadmin") {
            const queryId = searchParams.get("poolId");
            if (queryId) poolId = queryId;
        }

        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [sessionAgg, pool, hourlyAgg] = await Promise.all([
            // Current occupancy via active PoolSessions
            PoolSession.aggregate([
                { $match: { poolId, status: "active" } },
                { $group: { _id: null, total: { $sum: "$numPersons" } } },
            ]),
            // Pool capacity
            Pool.findOne({ poolId }).select("capacity poolName").lean(),
            // 24h entry history grouped by hour
            EntryLog.aggregate([
                { $match: { poolId, status: "granted", createdAt: { $gte: since24h } } },
                {
                    $group: {
                        _id: {
                            hour: { $hour: "$createdAt" },
                            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                        },
                        entries: { $sum: "$numPersons" },
                        count:   { $sum: 1 },
                    },
                },
                { $sort: { "_id.date": 1, "_id.hour": 1 } },
            ]),
        ]);

        const currentOccupancy = sessionAgg[0]?.total ?? 0;
        const capacity = (pool as any)?.capacity ?? 100;
        const poolName = (pool as any)?.poolName ?? "Pool";

        return NextResponse.json({
            poolId,
            poolName,
            currentOccupancy,
            capacity,
            utilizationPct: Math.round((currentOccupancy / capacity) * 100),
            status: currentOccupancy / capacity < 0.7 ? "green"
                  : currentOccupancy / capacity < 0.9 ? "amber"
                  : "red",
            hourlyHistory: hourlyAgg.map((h) => ({
                label:    `${h._id.date} ${String(h._id.hour).padStart(2, "0")}:00`,
                hour:     h._id.hour,
                entries:  h.entries ?? 0,
                scanCount: h.count ?? 0,
            })),
            updatedAt: new Date().toISOString(),
        }, {
            headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
        });
    } catch (error) {
        console.error("[GET /api/occupancy]", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}
