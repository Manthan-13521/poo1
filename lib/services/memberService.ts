import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { DeletedMember } from "@/models/DeletedMember";
import { EntryLog } from "@/models/EntryLog";
import { Attendance } from "@/models/Attendance";
import { Plan } from "@/models/Plan";
import { logger } from "@/lib/logger";
import mongoose from "mongoose";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExpireMembersPayload {
    // Currently no parameters needed — processes all pools
}

export interface ExpireMembersResult {
    markedExpired: number;
    softDeletedQuick: number;
    softDeletedStandard: number;
    logsDeleted: number;
    attendanceDeleted: number;
    hardDeleted: number;
    entertainmentHardDeleted: number;
}

// ── Handle Member Expiry ─────────────────────────────────────────────────
// Extracted from /api/cron/cleanup GET handler.
// Full lifecycle state machine: mark expired → soft-delete → purge logs → hard-delete.

export async function handleMemberExpiry(): Promise<ExpireMembersResult> {
    await dbConnect();

    const now = new Date();
    const results: ExpireMembersResult = {
        markedExpired: 0,
        softDeletedQuick: 0,
        softDeletedStandard: 0,
        logsDeleted: 0,
        attendanceDeleted: 0,
        hardDeleted: 0,
        entertainmentHardDeleted: 0,
    };

    const quickDeletePlanIds: mongoose.Types.ObjectId[] = await Plan.find({ quickDelete: true }).distinct("_id");
    const standardPlanIds: mongoose.Types.ObjectId[] = await Plan.find({ quickDelete: false }).distinct("_id");

    const collections: [mongoose.Model<any>, boolean][] = [
        [Member as mongoose.Model<any>, false],
        [EntertainmentMember as mongoose.Model<any>, true],
    ];

    for (const [Col, isEntertainment] of collections) {
        // ─── STEP 1: Mark as expired ─────────────────────────────────────
        const expiredRes = await Col.updateMany(
            { isExpired: false, isDeleted: false, planEndDate: { $lt: now } },
            { $set: { isExpired: true, expiredAt: now, status: "expired" } }
        );
        results.markedExpired += expiredRes.modifiedCount;

        // ─── STEP 2A: Quick Delete — 3 days after expiry ──────────────────
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        const quickRes = await Col.updateMany(
            {
                isExpired: true,
                isDeleted: false,
                expiredAt: { $lt: threeDaysAgo },
                planId: { $in: quickDeletePlanIds },
            },
            { $set: { isDeleted: true, deletedAt: now, deleteReason: "auto_quick", isActive: false, status: "deleted" } }
        );
        results.softDeletedQuick += quickRes.modifiedCount;

        // ─── STEP 2B: Standard — 10 days after expiry ────────────────────
        const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
        const stdRes = await Col.updateMany(
            {
                isExpired: true,
                isDeleted: false,
                expiredAt: { $lt: tenDaysAgo },
                planId: { $in: standardPlanIds },
            },
            { $set: { isDeleted: true, deletedAt: now, deleteReason: "auto_standard", isActive: false, status: "deleted" } }
        );
        results.softDeletedStandard += stdRes.modifiedCount;

        // ─── STEP 3: Purge ALL entry logs older than 5 days ───────────────
        const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        const entryLogPurge = await EntryLog.deleteMany({ scanTime: { $lt: fiveDaysAgo } });
        results.logsDeleted += entryLogPurge.deletedCount || 0;

        // ─── STEP 4: Hard-delete members ───────
        let hardDeleteDate;
        if (isEntertainment) {
            hardDeleteDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        } else {
            hardDeleteDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
        }

        const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

        const hardDeleteQuery = {
            $or: [
                { planEndDate: { $lt: hardDeleteDate } },
                { isDeleted: true, deletedAt: { $lt: sixDaysAgo } },
            ],
        };

        const toLogPurgeQuery = {
            $or: [
                { planEndDate: { $lt: hardDeleteDate } },
                { isDeleted: true, deletedAt: { $lt: threeDaysAgo } },
            ],
        };

        const toLogPurge: { _id: mongoose.Types.ObjectId }[] = await Col
            .find(toLogPurgeQuery)
            .select("_id")
            .lean();

        if (toLogPurge.length > 0) {
            const memberIds = toLogPurge.map((m) => m._id);
            const attRes = await Attendance.deleteMany({ userId: { $in: memberIds } });
            results.attendanceDeleted += attRes.deletedCount;
        }

        // Archive before hard deleting
        const toHardDelete = await Col.find(hardDeleteQuery).lean();
        if (toHardDelete.length > 0) {
            const archiveDocs = toHardDelete.map((doc: any) => ({
                originalId: doc._id,
                memberId: doc.memberId,
                name: doc.name,
                phone: doc.phone,
                poolId: doc.poolId,
                deletedAt: now,
                deletionType: "auto",
                collectionSource: isEntertainment ? "entertainment_members" : "members",
                fullData: doc,
            }));
            await DeletedMember.insertMany(archiveDocs);
        }

        const hardRes = await Col.deleteMany(hardDeleteQuery);
        if (isEntertainment) {
            results.entertainmentHardDeleted = hardRes.deletedCount;
        } else {
            results.hardDeleted = hardRes.deletedCount;
        }
    }

    logger.info("[MemberService] Expiry cleanup completed", results as any);
    return results;
}
