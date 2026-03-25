import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { EntryLog } from "@/models/EntryLog";
import { Payment } from "@/models/Payment";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/logs
 * Unified paginated activity log combining entry scans, payments, and registrations.
 * Supports: ?type=all|entry|payment|registration&page=1&limit=50
 */
export async function GET(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const filterType = searchParams.get("type") || "all";
        const page   = Math.max(1, parseInt(searchParams.get("page")  ?? "1"));
        const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "100")));
        const skip   = (page - 1) * limit;

        const baseMatch: Record<string, unknown> =
            session.user.role !== "superadmin" && session.user.poolId
                ? { poolId: session.user.poolId }
                : {};

        // ── Fetch each log type in parallel based on filter ──────────────
        const [entriesRaw, payments, regularRegistrations, entertainmentRegistrations] = await Promise.all([
            (filterType === "all" || filterType === "entry")
                ? EntryLog.find({ ...baseMatch, status: { $in: ["granted", "denied"] } })
                      .select("memberId poolId scanTime status reason entryType numPersons")
                      .sort({ scanTime: -1 })
                      .limit(200)
                      .lean()
                : Promise.resolve([]),
            Promise.resolve([]),
            (filterType === "all" || filterType === "registration")
                ? Member.find({ ...baseMatch, isDeleted: false })
                      .select("name memberId photoUrl planId createdAt")
                      .sort({ createdAt: -1 })
                      .limit(200)
                      .lean()
                : Promise.resolve([]),
            (filterType === "all" || filterType === "registration")
                ? Promise.resolve([])
                : Promise.resolve([]),
        ]);

        const registrations = [...(regularRegistrations as any[]), ...(entertainmentRegistrations as any[])]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 200);

        // ── Manually populate entries to support both member collections
        const memberIds = [...new Set((entriesRaw as any[]).map(e => e.memberId?.toString()).filter(Boolean))];
        const [membersFound, entMembersFound] = await Promise.all([
            Member.find({ _id: { $in: memberIds } }).select("name memberId photoUrl").lean(),
            EntertainmentMember.find({ _id: { $in: memberIds } }).select("name memberId photoUrl").lean(),
        ]);
        const memberMap = new Map();
        membersFound.forEach((m: any) => memberMap.set(m._id.toString(), m));
        entMembersFound.forEach((m: any) => memberMap.set(m._id.toString(), m));
        
        const entries = (entriesRaw as any[]).map(e => {
            if (e.memberId) {
                e.memberId = memberMap.get(e.memberId.toString()) || null;
            }
            return e;
        });

        // ── Normalise to unified shape ────────────────────────────────────
        const unified: any[] = [];

        for (const e of entries as any[]) {
            unified.push({
                id:          `entry_${e._id}`,
                date:        e.scanTime,
                type:        "Entry Scan",
                description: `Entry ${(e.status as string).toUpperCase()}${e.reason ? ` (${e.reason})` : ""}`,
                member:      e.memberId?.name   ?? (e.rawPayload ? "Unknown / Not Found" : "Unknown"),
                memberId:    e.memberId?.memberId ?? "N/A",
                photoUrl:    e.memberId?.photoUrl,
                meta:        { status: e.status, entryType: e.entryType },
            });
        }

        // Disabled payment log formatting as per feature constraints

        for (const m of registrations as any[]) {
            unified.push({
                id:          `reg_${m._id}`,
                date:        m.createdAt,
                type:        "Registration",
                description: "New member registered",
                member:      m.name,
                memberId:    m.memberId,
                photoUrl:    m.photoUrl,
                meta:        { planId: m.planId },
            });
        }

        // No memberId filtering – include all logs
        const filteredUnified = unified;

        // Sort by date desc, then paginate
        filteredUnified.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const total  = filteredUnified.length;
        const paged  = filteredUnified.slice(skip, skip + limit);

        return NextResponse.json({
    data:       paged,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
}, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error("[GET /api/logs]", error);
        return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
    }
}
