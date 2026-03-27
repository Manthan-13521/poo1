import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Pool } from "@/models/Pool";
import { Member } from "@/models/Member";
import { StudentMember } from "@/models/StudentMember";
import { BlacklistedMember } from "@/models/BlacklistedMembers";
import { EntryLog } from "@/models/EntryLog";
import { memberCache } from "@/lib/cache";
import { ScanSchema } from "@/lib/validators";

// High Performance Entry/Exit Scan Route (< 200ms Target)
export async function POST(req: Request) {
    try {
        const startTime = Date.now();
        await dbConnect();
        const body = await req.json();
        const result = ScanSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: "Invalid scan parameters", details: result.error.flatten() }, { status: 400 });
        }
        const { poolId, scanToken, type, method } = result.data;

        // 1. Smart Crowd Control Evaluation (Only on Entry)
        let pool = await Pool.findOne({ poolId }).lean() as any;
        if (!pool) pool = { capacity: 100 }; // Fallback

        if (type === "entry") {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Fetch live occupancy today
            // Note: Optimally this could be cached or kept as an active integer in the Pool model directly.
            const activeEntriesCount = await EntryLog.countDocuments({
                poolId,
                status: "granted",
                reason: "entry_scan",
                scanTime: { $gte: today }
            });

            const activeExitsCount = await EntryLog.countDocuments({
                poolId,
                status: "granted",
                reason: "exit_scan",
                scanTime: { $gte: today }
            });

            const activeSwimmers = Math.max(0, activeEntriesCount - activeExitsCount);

            // Phase 4: Smart Pool Crowd Control logic at 90%
            if (activeSwimmers >= pool.capacity * 0.9) {
                return NextResponse.json({ 
                    success: false, 
                    reason: "POOL_FULL", 
                    message: "Pool is currently full. Please wait for the next slot." 
                }, { status: 403 });
            }
        }

        // 2. High-Speed Cache Verification Layer
        const cacheKey = `member_${poolId}_${scanToken}`;
        let memberData = memberCache.get(cacheKey);

        if (!memberData) {
            // Priority Fallback to DB if cache misses
            let member = await Member.findOne({ qrToken: scanToken, poolId }).lean();
            if (!member) {
                member = (await StudentMember.findOne({ qrToken: scanToken, poolId }).lean()) as any;
            }

            if (!member) {
                return NextResponse.json({ success: false, reason: "INVALID_TOKEN" }, { status: 404 });
            }

            // Blacklist Validation
            const isBlacklisted = await BlacklistedMember.exists({ memberId: member.memberId, poolId });
            if (isBlacklisted) {
                return NextResponse.json({ success: false, reason: "BLACKLISTED" }, { status: 403 });
            }

            // Expiry Validation
            if (new Date() > new Date(member.expiryDate ?? 0) || member.status !== "active") {
                return NextResponse.json({ success: false, reason: "MEMBERSHIP_EXPIRED" }, { status: 403 });
            }

            memberData = { memberId: member._id, idString: member.memberId, name: member.name };
            
            // Cache verified profile for 5 minutes mapping
            memberCache.set(cacheKey, memberData, 300);
        }

        // 3. Persist the Activity Log
        await EntryLog.create({
            memberId: memberData.memberId,
            poolId,
            scanTime: new Date(),
            status: "granted",
            reason: type === "exit" ? "exit_scan" : "entry_scan",
            qrToken: scanToken,
            rawPayload: method || "qr"
        });

        const processingTime = Date.now() - startTime;

        return NextResponse.json({ 
            success: true, 
            message: `${type === "entry" ? "Access Granted" : "Exit Recorded"}`,
            member: memberData.name,
            processingTimeMs: processingTime
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
