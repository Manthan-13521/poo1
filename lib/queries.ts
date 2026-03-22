import { unstable_cache } from "next/cache";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Plan } from "@/models/Plan";
import { NotificationLog } from "@/models/NotificationLog";
import { Payment } from "@/models/Payment";
import { EntryLog } from "@/models/EntryLog";

/**
 * ── Member list (all members) ──────────────────────────────────────────
 */
export const getCachedMembers = unstable_cache(
    async (poolId: string, page: number = 1, limit: number = 50) => {
        await dbConnect();
        const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};
        
        const skip = (page - 1) * limit;
        
        const [members, total] = await Promise.all([
            Member.find({ ...baseMatch, isDeleted: false })
                .populate("planId", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Member.countDocuments({ ...baseMatch, isDeleted: false })
        ]);
        
        return { members, total, page, limit };
    },
    ["cached-members-list"],
    { revalidate: 15 }
);

/**
 * ── Analytics summary data ─────────────────────────────────────────────
 */
export const getCachedAnalyticsSummary = unstable_cache(
    async (poolId: string) => {
        await dbConnect();
        const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const [
            activeMembers,
            totalRevenue,
            monthlyRevenue,
            entriesToday
        ] = await Promise.all([
            Member.countDocuments({ ...baseMatch, isDeleted: false, status: "active" }),
            Payment.aggregate([
                { $match: { ...baseMatch, status: "success" } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            Payment.aggregate([
                { $match: { ...baseMatch, status: "success", date: { $gte: thisMonth } } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]),
            EntryLog.aggregate([
                { $match: { ...baseMatch, scanTime: { $gte: today }, status: "granted" } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$numPersons", 1] } } } }
            ])
        ]);

        return {
            activeMembers,
            totalRevenue: totalRevenue[0]?.total || 0,
            monthlyRevenue: monthlyRevenue[0]?.total || 0,
            entriesToday: entriesToday[0]?.total || 0,
        };
    },
    ["cached-analytics-summary"],
    { revalidate: 60 }
);

/**
 * ── Plans list ─────────────────────────────────────────────────────────
 */
export const getCachedPlans = unstable_cache(
    async (poolId: string) => {
        await dbConnect();
        const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};
        return Plan.find({ ...baseMatch, deletedAt: null }).sort({ createdAt: -1 }).lean();
    },
    ["cached-plans-list"],
    { revalidate: 120 }
);

/**
 * ── Notification logs ──────────────────────────────────────────────────
 */
export const getCachedNotificationLogs = unstable_cache(
    async (poolId: string, limit: number = 50) => {
        await dbConnect();
        const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};
        return NotificationLog.find(baseMatch)
            .populate("memberId", "name phone memberId")
            .sort({ date: -1 })
            .limit(limit)
            .lean();
    },
    ["cached-notification-logs"],
    { revalidate: 30 }
);

/**
 * ── Dashboard summary counts ───────────────────────────────────────────
 */
export const getCachedDashboardCounts = unstable_cache(
    async (poolId: string) => {
        await dbConnect();
        const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalMembers, activeMembers, todaysEntries] = await Promise.all([
            Member.countDocuments({ ...baseMatch, isDeleted: false }),
            Member.countDocuments({ ...baseMatch, isDeleted: false, status: "active" }),
            EntryLog.aggregate([
                { $match: { ...baseMatch, scanTime: { $gte: today }, status: "granted" } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$numPersons", 1] } } } }
            ])
        ]);

        return {
            totalMembers,
            activeMembers,
            todaysEntries: todaysEntries[0]?.total || 0,
        };
    },
    ["cached-dashboard-counts"],
    { revalidate: 30 }
);
