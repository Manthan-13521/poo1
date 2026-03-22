import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { Payment } from "@/models/Payment";
import { getServerSession } from "next-auth";
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

export async function GET(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(req.url);
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
        const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get("limit") ?? "10"))
        );
        const skip = (page - 1) * limit;

        // Build tenant-isolated query — never return deleted members by default
        const query: Record<string, unknown> = { isDeleted: false };
        if (session.user.role !== "superadmin" && session.user.poolId) {
            query.poolId = session.user.poolId;
        }

        // Optional filters
        const search = url.searchParams.get("search");
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: "i" } },
                { phone: { $regex: search, $options: "i" } },
                { memberId: { $regex: search, $options: "i" } },
            ];
        }
        const planFilter = url.searchParams.get("planId");
        if (planFilter) query.planId = planFilter;

        const statusFilter = url.searchParams.get("status");
        if (statusFilter === "active") query.isExpired = false;
        if (statusFilter === "expired") query.isExpired = true;

        const balanceOnly = url.searchParams.get("balanceOnly");
        if (balanceOnly === "true") query.balanceAmount = { $gt: 0 };

        // ── Server-side paginated queries on both collections ────────────
        const populateFields = "name durationDays durationHours durationMinutes price voiceAlert hasTokenPrint quickDelete";

        // Get totals first
        const [regularTotal, entertainmentTotal] = await Promise.all([
            Member.countDocuments(query),
            EntertainmentMember.countDocuments(query),
        ]);
        const combinedTotal = regularTotal + entertainmentTotal;

        let data: any[] = [];

        if (skip < regularTotal) {
            const regularLimit = Math.min(limit, regularTotal - skip);
            const remaining = limit - regularLimit;

            const [regularMembers, entertainmentMembers] = await Promise.all([
                Member.find(query)
                    .select(LIST_SELECT)
                    .populate("planId", populateFields)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(regularLimit)
                    .lean(),
                remaining > 0
                    ? EntertainmentMember.find(query)
                        .select(LIST_SELECT)
                        .populate("planId", populateFields)
                        .sort({ createdAt: -1 })
                        .skip(0)
                        .limit(remaining)
                        .lean()
                    : Promise.resolve([]),
            ]);

            data = [
                ...regularMembers,
                ...entertainmentMembers.map((m: any) => ({ ...m, _source: "entertainment" })),
            ];
        } else {
            const entertainmentSkip = skip - regularTotal;
            const entertainmentMembers = await EntertainmentMember.find(query)
                .select(LIST_SELECT)
                .populate("planId", populateFields)
                .sort({ createdAt: -1 })
                .skip(entertainmentSkip)
                .limit(limit)
                .lean();
            data = entertainmentMembers.map((m: any) => ({ ...m, _source: "entertainment" }));
        }

        return NextResponse.json({
            data,
            total: combinedTotal,
            page,
            limit,
            totalPages: Math.ceil(combinedTotal / limit),
        }, {
            headers: {
                "Cache-Control": `private, max-age=${Math.floor(PRIVATE_API_STALE_MS / 1000)}, stale-while-revalidate=30`,
            },
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
        await dbConnect();

        const ip = getClientIp(req);
        if (!checkRateLimit(ip, "member-create", 20)) {
            return NextResponse.json({ error: "Too many member creations. Slow down." }, { status: 429 });
        }

        const [session, body] = await Promise.all([
            getServerSession(authOptions),
            req.json(),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
            session.user.role !== "superadmin"
                ? session.user.poolId
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

        // Generate and upload Secure JWT QR code (Section 10)
        const qrPayloadObject = await signQRToken(memberId);
        let qrCodeUrl = "";
        try {
            const qrPngBuffer = await QRCode.toBuffer(
                qrPayloadObject,
                { width: 300 }
            );
            qrCodeUrl = await uploadBuffer(
                qrPngBuffer,
                "swimming-pool/qrcodes",
                `${poolId}_${memberId}_qr`
            );
        } catch {
            try {
                qrCodeUrl = await QRCode.toDataURL(qrPayloadObject, {
                    width: 300,
                });
            } catch {
                console.warn("QR generation failed");
            }
        }

        // We still need a unique token for the DB `qrToken` field as a uniqueness/fallback marker 
        // to rotate in the `Member` document. We'll use a random UUID.
        const qrToken = crypto.randomUUID();

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
                    recordedBy: (typeof session.user.id === "string" && session.user.id.length === 24)
                        ? new mongoose.Types.ObjectId(session.user.id)
                        : undefined,
                    status: "success",
                    notes: `Auto-recorded on member registration`,
                });
            } catch (payErr) {
                console.warn("Payment creation failed (non-critical):", payErr);
            }
        }

        // Populate plan for response (needed for token print check on frontend)
        const savedMember = isEntertainment
            ? await EntertainmentMember.findById(newMember._id).populate("planId", "name hasTokenPrint quickDelete price")
            : await Member.findById(newMember._id).populate("planId", "name hasTokenPrint quickDelete price");

        return NextResponse.json(savedMember, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/members]", error);
        return NextResponse.json(
            { error: error?.message || "Server error creating member" },
            { status: 500 }
        );
    }
}
