import { NextResponse } from "next/server";
import { Plan } from "@/models/Plan"; // Added import for group QR handling
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntryLog } from "@/models/EntryLog";
import { PoolSession } from "@/models/PoolSession";
import { Pool } from "@/models/Pool";
import { getSettings } from "@/models/Settings"; // Kept for legacy global fallback if needed
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { verifyQRToken } from "@/lib/qrSigner";
import mongoose from "mongoose";
import { runOccupancyCleanupInBackground } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

const SCAN_COOLDOWN_MS = 3000; // 3-second cooldown

export async function POST(req: Request) {
    // ── Rate limit: max 50 scans / minute per IP (Section 8B)
    const ip = getClientIp(req);
    const isAllowed = checkRateLimit(ip, "entry", 50);
    if (!isAllowed) {
        logger.warn("Entry rate limit hit", { ip });
        return NextResponse.json({ error: "Too many scan requests. Slow down." }, { status: 429 });
    }

    try {
        const [, session, body] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
            req.json(),
        ]);
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { qrPayload } = body; // Format: "memberId:qrToken"  OR legacy plain memberId

        if (!qrPayload) {
            return NextResponse.json({ error: "Missing QR payload" }, { status: 400 });
        }

        // Parse payload — support JWT (Section 10), legacy "memberId:token", and legacy plain memberId
        let memberId: string = "";
        let providedToken: string | null = null;
        let planId: string | null = null;

        // Try JWT verification first
        const jwtVerifiedId = await verifyQRToken(qrPayload);
        if (jwtVerifiedId) {
            memberId = jwtVerifiedId;
            providedToken = qrPayload; // Treat the JWT string as the token for logs
        } else if (qrPayload.includes(":")) {
            const parts = qrPayload.split(":");
            const possibleId = parts[0];
            const possibleToken = parts.slice(1).join(":");

            const plan = await Plan.findById(possibleId).lean().catch(() => null);
            if (plan && plan.groupToken && plan.groupToken === possibleToken) {
                planId = possibleId;
                providedToken = possibleToken;
            } else {
                memberId = possibleId;
                providedToken = possibleToken;
            }
        } else {
            memberId = qrPayload;
        }

        // Auto-cleanup expired sessions before checking capacity
        await runOccupancyCleanupInBackground();

        let member = null;
        if (planId) {
            // Group QR handling
            const plan = await Plan.findById(planId).lean();
            if (!plan) {
                logger.scan("QR scan denied — plan not found", { planId });
                await EntryLog.create({
                    status: "denied",
                    reason: "Plan Not Found",
                    operatorId: session.user.id ? new mongoose.Types.ObjectId(session.user.id) : undefined,
                    rawPayload: qrPayload,
                });
                return NextResponse.json({ error: "Plan not found" }, { status: 404 });
            }

            const numPersons = plan.maxEntriesPerQR || 1;
            
            // Dynamic tenant occupancy lookup
            let currentOccupancy = 0;
            const pool = await Pool.findOne({ poolId: session.user.poolId }).select("capacity").lean();
            const poolCapacity = pool?.capacity || 100;
            const sessionAgg = await PoolSession.aggregate([
                { $match: { poolId: session.user.poolId, status: "active" } },
                { $group: { _id: null, total: { $sum: "$numPersons" } } }
            ]);
            if (sessionAgg.length > 0) currentOccupancy = sessionAgg[0].total;

            // Check capacity for the whole group
            if (currentOccupancy + numPersons > poolCapacity) {
                await EntryLog.create({
                    poolId: session.user.poolId,
                    status: "denied",
                    reason: "Pool Capacity Full for Group",
                    rawPayload: qrPayload,
                });
                return NextResponse.json({ 
                    error: `Pool cannot accommodate ${numPersons} more people (${currentOccupancy}/${poolCapacity})` 
                }, { status: 400 });
            }

            if (plan.remainingEntries && plan.remainingEntries > 0) {
                // Decrement remaining entries atomically
                await Plan.updateOne({ _id: planId, remainingEntries: { $gt: 0 } }, { $inc: { remainingEntries: -1 } });
                
                // Calculate expiry for this session
                const expiryTime = new Date();
                if (plan.durationSeconds) expiryTime.setSeconds(expiryTime.getSeconds() + plan.durationSeconds);
                else if (plan.durationMinutes) expiryTime.setMinutes(expiryTime.getMinutes() + plan.durationMinutes);
                else if (plan.durationHours) expiryTime.setHours(expiryTime.getHours() + plan.durationHours);
                else {
                    const settings = await getSettings();
                    const durationMinutes = settings.occupancyDurationMinutes || 60;
                    expiryTime.setMinutes(expiryTime.getMinutes() + durationMinutes);
                }

                // Create PoolSession for automated checkout
                await PoolSession.create({
                    poolId: session.user.poolId,
                    numPersons,
                    expiryTime,
                    status: "active",
                });

                // Log entry without member association
                await EntryLog.create({
                    poolId: session.user.poolId,
                    status: "granted",
                    reason: "Group QR Entry",
                    rawPayload: qrPayload,
                    numPersons,
                });
                
                return NextResponse.json({ 
                    message: "Group entry granted", 
                    numPersons,
                    occupancy: {
                        current: currentOccupancy + numPersons,
                        capacity: poolCapacity
                    }
                }, { status: 200 });
            } else {
                logger.scan("QR scan denied — group quota exhausted", { planId });
                await EntryLog.create({
                    status: "denied",
                    reason: "Group QR quota exhausted",
                    rawPayload: qrPayload,
                });
                return NextResponse.json({ error: "Group QR token has no remaining entries" }, { status: 403 });
            }
        }
        // Existing individual member flow
        const baseMatch = session.user.role !== "superadmin" && session.user.poolId ? { poolId: session.user.poolId } : {};
        member = await Member.findOne({ memberId, ...baseMatch }).populate("planId");

        // Fallback to EntertainmentMember if not found in regular Member collection
        if (!member) {
            const { EntertainmentMember } = await import("@/models/EntertainmentMember");
            member = await EntertainmentMember.findOne({ memberId, ...baseMatch }).populate("planId");
        }

        if (!member) {
            logger.scan("QR scan denied — member not found", { memberId });
            await EntryLog.create({
                poolId: session.user.poolId || "UNKNOWN",
                status: "denied",
                reason: "Member Not Found",
                operatorId: session.user.id ? new mongoose.Types.ObjectId(session.user.id) : undefined,
                rawPayload: qrPayload,
            });
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // ── QR Token Verification ────────────────────────────────────────────
        if (providedToken && member.qrToken && providedToken !== member.qrToken) {
            logger.scan("QR scan denied — invalid token (possible screenshot reuse)", {
                memberId,
                ip,
            });
            await EntryLog.create({
                poolId: session.user.poolId,
                memberId: member._id,
                status: "denied",
                reason: "Invalid QR Token (possible screenshot reuse)",
                operatorId: new mongoose.Types.ObjectId(session.user.id),
                qrToken: providedToken,
                rawPayload: qrPayload,
            });
            return NextResponse.json(
                { error: "QR code is invalid or already used. Please regenerate your QR." },
                { status: 403 }
            );
        }

        // ── Duplicate Scan Cooldown ──────────────────────────────────────────
        if (member.lastScannedAt) {
            const msSinceLastScan = Date.now() - new Date(member.lastScannedAt).getTime();
            if (msSinceLastScan < SCAN_COOLDOWN_MS) {
                logger.scan("QR scan denied — cooldown", { memberId, msSinceLastScan });
                return NextResponse.json(
                    { error: `Please wait ${Math.ceil((SCAN_COOLDOWN_MS - msSinceLastScan) / 1000)} seconds before scanning again.` },
                    { status: 429 }
                );
            }
        }

        // ── Membership Expiry Check ──────────────────────────────────────────
        const isEntertainment = !('status' in (member as any));
        const memberStatus = isEntertainment ? ((member as any).isActive && !(member as any).isExpired ? "active" : "expired") : (member as any).status;
        const expiryFieldValue = isEntertainment ? (member as any).planEndDate : (member as any).expiryDate;

        if (memberStatus !== "active" || new Date(expiryFieldValue ?? 0) < new Date()) {
            if (isEntertainment) {
                if ((member as any).isActive) {
                    (member as any).isActive = false;
                    (member as any).isExpired = true;
                    await member.save();
                }
            } else {
                if ((member as any).status === "active") {
                    (member as any).status = "expired";
                    await member.save();
                }
            }
            await EntryLog.create({
                poolId: session.user.poolId,
                memberId: member._id,
                status: "denied",
                reason: "Membership Expired",
                operatorId: new mongoose.Types.ObjectId(session.user.id),
                rawPayload: qrPayload,
            });
            logger.scan("QR scan denied — expired", { memberId });
            return NextResponse.json({ error: "Membership has expired" }, { status: 403 });
        }

        // ── Entry Limit Check (Total & Daily) ───────────────────────────────
        // Preliminary check for fast rejection
        if (!isEntertainment) {
            const entriesUsed = (member as any).entriesUsed || 0;
            const totalEntriesAllowed = (member as any).totalEntriesAllowed || 1;

            if (entriesUsed >= totalEntriesAllowed) {
                await EntryLog.create({
                    poolId: session.user.poolId,
                    memberId: member._id,
                    status: "denied",
                    reason: "Entry Limit Reached",
                    operatorId: new mongoose.Types.ObjectId(session.user.id),
                    rawPayload: qrPayload,
                });
                logger.scan("QR scan denied — entry limit", { memberId, entriesUsed, totalEntriesAllowed });
                return NextResponse.json({ error: "Entry limit reached" }, { status: 400 });
            }
        }

        // ── Daily 1-Time Entry Limit Check ───────────────────────────────────
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const alreadyEnteredToday = await EntryLog.findOne({
            poolId: session.user.poolId,
            memberId: member._id,
            status: "granted",
            createdAt: { $gte: startOfDay },
        });

        if (alreadyEnteredToday) {
            await EntryLog.create({
                poolId: session.user.poolId,
                memberId: member._id,
                status: "denied",
                reason: "Already Entered Today",
                operatorId: new mongoose.Types.ObjectId(session.user.id),
                rawPayload: qrPayload,
            });
            logger.scan("QR scan denied — already entered today", { memberId });
            return NextResponse.json(
                { error: "Member has already entered once today." },
                { status: 403 }
            );
        }

        // ── Pool Capacity Check ──────────────────────────────────────────────
        // Dynamic tenant occupancy lookup calculation again for individual members
        let currentOccupancy = 0;
        const pool = await Pool.findOne({ poolId: session.user.poolId }).select("capacity").lean();
        const poolCapacity = pool?.capacity || 100;
        const sessionAgg = await PoolSession.aggregate([
            { $match: { poolId: session.user.poolId, status: "active" } },
            { $group: { _id: null, total: { $sum: "$numPersons" } } }
        ]);
        if (sessionAgg.length > 0) currentOccupancy = sessionAgg[0].total;

        const numPersons = member.planQuantity || 1;

        if (currentOccupancy + numPersons > poolCapacity) {
            await EntryLog.create({
                poolId: session.user.poolId,
                memberId: member._id,
                status: "denied",
                reason: "Pool at Full Capacity",
                operatorId: new mongoose.Types.ObjectId(session.user.id),
                rawPayload: qrPayload,
            });
            logger.scan("QR scan denied — pool full", {
                memberId,
                occupancy: currentOccupancy,
                capacity: poolCapacity,
                requested: numPersons
            });
            return NextResponse.json(
                {
                    error: `Pool cannot accommodate ${numPersons} more people (${currentOccupancy}/${poolCapacity}).`,
                },
                { status: 400 }
            );
        }

        // ── Grant Entry (Atomic Update - Section 9) ──────────────────────────
        const oldToken = member.qrToken;
        const newToken = require("crypto").randomUUID();

        if (!isEntertainment) {
            // Use findOneAndUpdate to atomically increment entriesUsed while ensuring it's strictly less than total allowed
            const updatedMember = await mongoose.models.Member.findOneAndUpdate(
                { 
                    _id: member._id, 
                    entriesUsed: { $lt: (member as any).totalEntriesAllowed || 1 } 
                },
                { 
                    $inc: { entriesUsed: 1 },
                    $set: { lastScannedAt: new Date(), qrToken: newToken }
                },
                { new: true }
            );

            if (!updatedMember) {
                // Race condition! Another request beat us to the limit.
                return NextResponse.json({ error: "Entry limit reached (Double Scan Prevented)" }, { status: 400 });
            }
            member = updatedMember; // Sync local object for logging
        } else {
            // Entertainment members don't have entry limits
            member.lastScannedAt = new Date();
            member.qrToken = newToken;
            await member.save();
        }

        // Create PoolSession for automated checkout
        let expiryFieldValueForSession = new Date();
        const planObj = (member as any).planId;
        const settings = await getSettings();
        const durationMinutes = settings.occupancyDurationMinutes || 60;

        if (!isEntertainment && planObj && planObj.durationHours && !planObj.durationDays) {
            // Hourly plan
            expiryFieldValueForSession.setHours(expiryFieldValueForSession.getHours() + planObj.durationHours);
            if (planObj.durationMinutes) {
                expiryFieldValueForSession.setMinutes(expiryFieldValueForSession.getMinutes() + planObj.durationMinutes);
            }
        } else {
            // Daily/Monthly/Yearly plan or Entertainment member -> use occupancy setting
            expiryFieldValueForSession.setMinutes(expiryFieldValueForSession.getMinutes() + durationMinutes);
        }

        await PoolSession.create({
            poolId: session.user.poolId,
            memberId: member._id,
            numPersons,
            expiryTime: expiryFieldValueForSession,
            status: "active",
        });

        const entry = await EntryLog.create({
            poolId: session.user.poolId,
            memberId: member._id,
            status: "granted",
            operatorId: (typeof session.user.id === "string" && session.user.id.length === 24) 
                ? new mongoose.Types.ObjectId(session.user.id) 
                : undefined,
            qrToken: oldToken,
            rawPayload: qrPayload,
            numPersons,
        });

            logger.scan("QR scan granted", {
            memberId,
            memberName: member.name,
            occupancy: currentOccupancy + numPersons,
            capacity: poolCapacity,
        });

        return NextResponse.json(
            {
                message: "Entry Granted",
                member: {
                    name: member.name,
                    memberId: member.memberId,
                    photoUrl: member.photoUrl,
                    planName: (member.planId as any)?.name || "Active Plan",
                    planQuantity: member.planQuantity || 1,
                    voiceAlert: (member.planId as any)?.voiceAlert || false,
                    expiryDate: expiryFieldValueForSession,
                },
                entry,
                occupancy: {
                    current: currentOccupancy + numPersons,
                    capacity: poolCapacity,
                    available: poolCapacity - (currentOccupancy + numPersons),
                },
            },
            { status: 200 }
        );
    } catch (error) {
        logger.error("Entry API error", { error: String(error) });
        return NextResponse.json({ error: "Server error processing entry" }, { status: 500 });
    }
}
