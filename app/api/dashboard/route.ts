import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Payment } from "@/models/Payment";
import { EntryLog } from "@/models/EntryLog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runOccupancyCleanupInBackground } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

// ── IST Timezone Helper ────────────────────────────────────────────────
function getISTDayBounds() {
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const startOfDayIST = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0)
    );
    startOfDayIST.setTime(startOfDayIST.getTime() - IST_OFFSET);

    const endOfDayIST = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999)
    );
    endOfDayIST.setTime(endOfDayIST.getTime() - IST_OFFSET);

    const startOfMonthIST = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0)
    );
    startOfMonthIST.setTime(startOfMonthIST.getTime() - IST_OFFSET);

    return { startOfDayIST, endOfDayIST, startOfMonthIST, now };
}

export async function GET() {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        
        runOccupancyCleanupInBackground();

        const { startOfDayIST, endOfDayIST, startOfMonthIST, now } = getISTDayBounds();

        const baseMatch = session.user.role !== "superadmin" && session.user.poolId 
            ? { poolId: session.user.poolId } 
            : {};
            
        // Execute all independent queries in parallel — NO CACHE, always fresh
        const [
            totalMembers,
            activeMembers,
            entriesToday,
            todaysRevenueAgg,
            monthlyRevenueAgg,
            expiringMembers
        ] = await Promise.all([
            // Total non-deleted members
            Member.countDocuments({ ...baseMatch, isDeleted: false }),

            // Active = not deleted AND expiry is in the future (real-time check)
            Member.countDocuments({
                ...baseMatch,
                isDeleted: false,
                $or: [
                    { planEndDate: { $gte: now } },
                    { expiryDate: { $gte: now } },
                ]
            }),

            // Today's entries — IST bounded
            EntryLog.aggregate([
                { $match: { ...baseMatch, scanTime: { $gte: startOfDayIST, $lte: endOfDayIST }, status: "granted" } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$numPersons", 1] } } } }
            ]),

            // Today's revenue — IST bounded, using createdAt
            Payment.aggregate([
                { $match: { ...baseMatch, status: "success", createdAt: { $gte: startOfDayIST, $lte: endOfDayIST } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),

            // Monthly revenue — IST bounded
            Payment.aggregate([
                { $match: { ...baseMatch, status: "success", createdAt: { $gte: startOfMonthIST } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),

            // Expiring in next 3 days
            Member.find({
                ...baseMatch,
                isDeleted: false,
                $or: [
                    { planEndDate: { $gte: startOfDayIST, $lte: new Date(startOfDayIST.getTime() + 3 * 86400000) } },
                    { expiryDate: { $gte: startOfDayIST, $lte: new Date(startOfDayIST.getTime() + 3 * 86400000) } },
                ]
            })
            .select('memberId name phone expiryDate planEndDate planQuantity')
            .lean()
        ]);

        const expiredMembers = totalMembers - activeMembers;

        const response = {
            stats: {
                totalMembers,
                activeMembers,
                expiredMembers,
                todaysEntries: entriesToday[0]?.total || 0,
                todaysRevenue: todaysRevenueAgg[0]?.total || 0,
                monthlyRevenue: monthlyRevenueAgg[0]?.total || 0,
            },
            alerts: {
                expiringMembers: expiringMembers.map((m: any) => ({
                    id: m._id,
                    memberId: m.memberId,
                    name: m.name,
                    phone: m.phone,
                    qty: m.planQuantity || 1,
                    remainingDays: Math.ceil(
                        (new Date(m.planEndDate || m.expiryDate).getTime() - startOfDayIST.getTime()) / 86400000
                    )
                }))
            }
        };

        return NextResponse.json(response, {
            headers: { "Cache-Control": "no-store", "X-Cache": "NONE" },
        });

    } catch (error) {
        console.error("[GET /api/dashboard]", error);
        return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 });
    }
}
