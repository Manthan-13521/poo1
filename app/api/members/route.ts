import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { Payment } from "@/models/Payment";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import QRCode from "qrcode";
import crypto from "crypto";
import { uploadBuffer } from "@/lib/local-upload";
import { savePhoto } from "@/lib/savePhoto";
import { signQRToken } from "@/lib/qrSigner";
import { PRIVATE_API_STALE_MS } from "@/lib/apiCache";

export const dynamic = "force-dynamic";


// Fields to exclude from list queries for performance (Section 6C)
const LIST_SELECT = "-faceDescriptor -photoUrl";

import { generateMemberId } from "@/lib/generateMemberId";
import { MemberCreateSchema } from "@/lib/validators";

import { getCache, setCache, invalidateCache } from "@/lib/membersCache";

export async function GET(req: Request) {
    try {
        const [token] = await Promise.all([
            getToken({ req: req as any }),
            dbConnect(),
        ]);
        
        if (!token)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const sessionUser = token as any;

        const url = new URL(req.url);
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
        const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get("limit") ?? "12"))
        );
        const skip = (page - 1) * limit;
        const search = url.searchParams.get("search") || "";
        const planFilter = url.searchParams.get("planId") || "";
        const statusFilter = url.searchParams.get("status") || "";
        const balanceOnly = url.searchParams.get("balanceOnly") || "";

        // ── Cache check (Redis → in-memory fallback) ─────────────────────
        const poolKey = sessionUser.poolId || "superadmin";
        const cacheKey = `members-${poolKey}-${page}-${limit}-${search}-${planFilter}-${statusFilter}-${balanceOnly}`;
        const cached = await getCache(cacheKey);
        if (cached) {
            return NextResponse.json(cached, {
                headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
            });
        }

        // ── Build match filter ───────────────────────────────────────────
        const baseMatch: Record<string, unknown> = { isDeleted: false };
        if (sessionUser.role !== "superadmin" && sessionUser.poolId) {
            baseMatch.poolId = sessionUser.poolId;
        }

        if (search) {
            baseMatch.$text = { $search: search };
        }
        if (planFilter) baseMatch.planId = new mongoose.Types.ObjectId(planFilter);
        if (statusFilter === "active") baseMatch.isExpired = false;
        if (statusFilter === "expired") baseMatch.isExpired = true;
        if (balanceOnly === "true") baseMatch.balanceAmount = { $gt: 0 };

        // ── Aggregation pipeline with $unionWith ─────────────────────────
        const pipeline: mongoose.PipelineStage[] = [
            { $match: baseMatch },
            { $addFields: { _source: "regular" } },
            {
                $unionWith: {
                    coll: "entertainment_members",
                    pipeline: [
                        { $match: baseMatch },
                        { $addFields: { _source: "entertainment" } },
                    ],
                },
            },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $lookup: {
                    from: "plans",
                    localField: "planId",
                    foreignField: "_id",
                    as: "_plan",
                    pipeline: [
                        { $project: { name: 1, durationDays: 1, durationHours: 1, durationMinutes: 1, price: 1, voiceAlert: 1, hasTokenPrint: 1, quickDelete: 1 } },
                    ],
                },
            },
            { $addFields: { planId: { $arrayElemAt: ["$_plan", 0] } } },
            {
                $project: {
                    _plan: 0, faceDescriptor: 0,
                },
            },
        ];

        const [rawData, regularTotal, entertainmentTotal] = await Promise.all([
            Member.aggregate(pipeline),
            Member.countDocuments(baseMatch),
            EntertainmentMember.countDocuments(baseMatch),
        ]);
        const total = regularTotal + entertainmentTotal;

        // ── Compute verdict server-side in JS (fast, resilient) ──────────
        const now = Date.now();
        const data = rawData.map((m: any) => {
            const endDate = new Date(m.planEndDate || m.expiryDate || 0);
            const msLeft = endDate.getTime() - now;

            let verdict = "ACTIVE";
            let verdictClass = "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-400";
            let rowClass = "";
            let daysLeftLabel = "";

            if (m.isDeleted) {
                verdict = "DELETED";
                verdictClass = "bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-400";
                rowClass = "bg-red-50 dark:bg-red-950/30";
                daysLeftLabel = "Deleted";
            } else if (m.isExpired || msLeft <= 0) {
                verdict = "EXPIRED";
                verdictClass = "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400";
                rowClass = "bg-red-50 dark:bg-red-950/30";
                daysLeftLabel = "Expired";
            } else {
                const daysLeft = Math.ceil(msLeft / 86400000);
                if (daysLeft <= 1) {
                    daysLeftLabel = "Expires today";
                } else {
                    daysLeftLabel = `${daysLeft} days left`;
                }
                if (daysLeft <= 7) {
                    verdict = "EXPIRING";
                    verdictClass = "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400";
                    rowClass = "bg-amber-50 dark:bg-amber-950/30";
                }
                m.daysLeft = daysLeft;
            }

            m.verdict = verdict;
            m.verdictClass = verdictClass;
            m.rowClass = rowClass;
            m.daysLeftLabel = daysLeftLabel;
            if (!m.daysLeft) m.daysLeft = 0;
            return m;
        });

        const response = {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };

        // Cache response (async, non-blocking)
        setCache(cacheKey, response).catch(() => {});

        return NextResponse.json(response, {
            headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
        });
    } catch (error) {
        console.error("[GET /api/members]", error);
        return NextResponse.json(
            { error: "Failed to fetch members" },
            { status: 500 }
        );
    }
}

import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
    try {
        const [token, body] = await Promise.all([
            getToken({ req: req as any }),
            req.json(),
            dbConnect(),
        ]);
        
        if (!token)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const sessionUser = token as any;

        // Rate limiting for member creation (Section 4)
        const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
        const ip = getClientIp(req);
        if (!checkRateLimit(ip, "member-create", 20)) {
            return NextResponse.json({ error: "Too many member creations. Slow down." }, { status: 429 });
        }

        // Map frontend fields to match Zod schema expectations
        const mappedBody = {
            ...body,
            paymentMethod: body.paymentMode || body.paymentMethod || "cash",
            photo: body.photoBase64 || body.photo,
        };

        const result = MemberCreateSchema.safeParse(mappedBody);
        if (!result.success) {
            const errs = result.error.flatten().fieldErrors;
            const errMsg = Object.entries(errs).map(([f, m]) => `${f}: ${m?.join(", ")}`).join(" | ");
            console.error("Zod Validation Failed:", errMsg, mappedBody);
            // Return error string explicitly to prevent [object Object] on UI
            return NextResponse.json({ error: String(errMsg) }, { status: 400 });
        }
        const data = result.data;

        // Use standard structure now that we've validated
        const {
            name,
            phone,
            planId,
            paymentMethod,
            transactionId,
            planQuantity,
            paidAmount,
            balanceAmount
        } = data;

        // Handle photo separately (since the Zod schema expects photo as string but the UI might send photoBase64)
        const photoBase64 = body.photoBase64 || data.photo;

        const { Plan } = await import("@/models/Plan");
        const plan = await Plan.findById(planId).lean();
        if (!plan)
            return NextResponse.json({ error: "Invalid Plan" }, { status: 400 });

        const poolId =
            sessionUser.role !== "superadmin"
                ? sessionUser.poolId
                : body.poolId;

        if (!poolId)
            return NextResponse.json(
                { error: "Pool ID required" },
                { status: 400 }
            );

        // Atomic ID generation via Counters collection (Section 5)
        const isEntertainment = plan.hasEntertainment ?? false;
        const memberId = await generateMemberId(isEntertainment);

        // Save photo locally (Section 6)
        let photoUrl = "";
        if (photoBase64) {
            try {
                photoUrl = await savePhoto(photoBase64);
            } catch (err) {
                console.warn("Local photo save failed, skipping:", err);
            }
        }

        // Inline QR Code Generation
        const qrToken = crypto.randomUUID();
        const qrPayloadObject = await signQRToken(memberId);
        let qrCodeUrl = "";
        try {
            const qrPngBuffer = await QRCode.toBuffer(qrPayloadObject, { width: 300 });
            qrCodeUrl = await uploadBuffer(qrPngBuffer, "swimming-pool/qrcodes", `${poolId}_${memberId}_qr`);
        } catch (e) {
            console.error("QR Code local upload failed, falling back to Data URL", e);
            qrCodeUrl = await QRCode.toDataURL(qrPayloadObject, { width: 300 });
        }

        // Calculate plan end date — duration is NOT multiplied by qty
        // Qty means N people using the same plan, not extended duration
        const qty = Math.min(25, Math.max(1, planQuantity || 1));
        const startDate = new Date();
        const planEndDate = new Date();

        if (plan.durationSeconds) {
            planEndDate.setSeconds(planEndDate.getSeconds() + plan.durationSeconds);
        } else if (plan.durationMinutes) {
            planEndDate.setMinutes(planEndDate.getMinutes() + plan.durationMinutes);
        } else if (plan.durationHours) {
            planEndDate.setHours(planEndDate.getHours() + plan.durationHours);
        } else {
            planEndDate.setDate(planEndDate.getDate() + (plan.durationDays || 30));
        }

        const paymentStatus =
            balanceAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "pending";

        // Build equipment array from string (if provided)
        let equipmentArr: { itemName: string; issuedDate: Date; isReturned: boolean }[] = [];
        if (body.equipmentTaken && typeof body.equipmentTaken === "string") {
            equipmentArr = body.equipmentTaken
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
                .map((item: string) => ({
                    itemName: item,
                    issuedDate: new Date(),
                    isReturned: false,
                }));
        }

        const MemberModel = isEntertainment ? EntertainmentMember : Member;

        const newMember = new MemberModel({
            memberId,
            poolId,
            name,
            phone,
            photoUrl,
            planId,
            planQuantity: qty,
            planStartDate: startDate,
            planEndDate,
            startDate,
            expiryDate: planEndDate,
            paidAmount,
            balanceAmount,
            paymentStatus,
            paymentMode: body.paymentMode ?? "cash",
            equipmentTaken: equipmentArr,
            faceScanEnabled: plan.hasFaceScan ?? false,
            faceDescriptor: body.faceDescriptor ?? [],
            qrCodeUrl,
            qrToken,
            isActive: true,
            isExpired: false,
            isDeleted: false,
            status: "active",
            cardStatus: "ready",
        });

        await newMember.save();

        // NOTE: PoolSession is NOT created here — occupancy only increases
        // when a member scans in via the QR Entry page (/api/entry).

        // Auto-create Payment record so it shows on the Payments page
        if (paidAmount > 0) {
            try {
                const modeMap: Record<string, string> = { cash: "cash", upi: "upi", card: "cash", online: "razorpay_online" };
                await Payment.create({
                    memberId: newMember._id,
                    planId,
                    poolId,
                    memberCollection: isEntertainment ? "entertainment_members" : "members",
                    amount: paidAmount,
                    paymentMethod: modeMap[body.paymentMode] || "cash",
                    recordedBy: (typeof sessionUser.id === "string" && sessionUser.id.length === 24)
                        ? new mongoose.Types.ObjectId(sessionUser.id)
                        : undefined,
                    status: "success",
                    notes: `Auto-recorded on member registration`,
                });
            } catch (payErr) {
                console.warn("Payment creation failed (non-critical):", payErr);
            }
        }

        const savedMember = isEntertainment
            ? await EntertainmentMember.findById(newMember._id).populate("planId", "name hasTokenPrint quickDelete price")
            : await Member.findById(newMember._id).populate("planId", "name hasTokenPrint quickDelete price");

        // No background job needed since generation is inline

        // Invalidate members cache for this pool
        invalidateCache(poolId).catch(() => {});

        return NextResponse.json(savedMember, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/members]", error);
        return NextResponse.json(
            { error: error?.message || "Server error creating member" },
            { status: 500 }
        );
    }
}
