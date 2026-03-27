import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { Plan } from "@/models/Plan";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import QRCode from "qrcode";
import crypto from "crypto";
import { uploadBuffer } from "@/lib/local-upload";
import { savePhoto } from "@/lib/savePhoto";
import { signQRToken } from "@/lib/qrSigner";
import { EntertainmentMemberCreateSchema } from "@/lib/validators";

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
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = { isDeleted: false };
        if (session.user.role !== "superadmin" && session.user.poolId) {
            query.poolId = session.user.poolId;
        }

        const search = url.searchParams.get("search");
        if (search) {
            const sanitized = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Prevent ReDoS
            query.$or = [
                { name: { $regex: sanitized, $options: "i" } },
                { phone: { $regex: sanitized, $options: "i" } },
                { memberId: { $regex: sanitized, $options: "i" } },
            ];
        }

        const [members, total] = await Promise.all([
            EntertainmentMember.find(query)
                .populate("planId", "name price hasTokenPrint")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            EntertainmentMember.countDocuments(query),
        ]);

        return NextResponse.json({
            data: members,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("[GET /api/entertainment-members]", error);
        return NextResponse.json({ error: "Failed to fetch entertainment members" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const result = EntertainmentMemberCreateSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json({ error: result.error.flatten() }, { status: 400 });
        }
        const { name, phone, planId, dob, photoBase64, aadharCard, address, planQuantity = 1, paidAmount = 0, balanceAmount = 0 } = result.data;

        const plan = await Plan.findById(planId).lean();
        if (!plan)
            return NextResponse.json({ error: "Invalid Plan" }, { status: 400 });

        const poolId = session.user.role !== "superadmin" ? session.user.poolId : body.poolId;
        if (!poolId)
            return NextResponse.json({ error: "Pool ID required" }, { status: 400 });

        // Atomic counter from Pool (not Plan) to avoid duplicates
        const { Pool } = await import("@/models/Pool");
        const updatedPool = await Pool.findOneAndUpdate(
            { poolId },
            { $inc: { entertainmentMemberCounter: 1 } },
            { new: true }
        );
        const counter = updatedPool!.entertainmentMemberCounter;
        const memberId = `MS${counter.toString().padStart(4, "0")}`;

        let age: number | undefined;
        if (dob) {
            const b = new Date(dob);
            const today = new Date();
            age = today.getFullYear() - b.getFullYear();
            const m = today.getMonth() - b.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
        }

        let photoUrl = "";
        if (photoBase64) {
            try {
                photoUrl = await savePhoto(photoBase64);
            } catch { /* skip if local save fails */ }
        }

        const qrToken = crypto.randomUUID();
        let qrCodeUrl = "";
        const qrPayloadObject = await signQRToken(memberId);
        try {
            const buf = await QRCode.toBuffer(qrPayloadObject, { width: 300 });
            qrCodeUrl = await uploadBuffer(buf, "swimming-pool/qrcodes", `${poolId}_${memberId}_qr`);
        } catch {
            try { qrCodeUrl = await QRCode.toDataURL(qrPayloadObject, { width: 300 }); } catch { /* ignore */ }
        }

        const startDate = new Date();
        const planEndDate = new Date();
        const multiplier = planQuantity || 1;
        if (plan.durationSeconds) planEndDate.setSeconds(planEndDate.getSeconds() + plan.durationSeconds * multiplier);
        else if (plan.durationMinutes) planEndDate.setMinutes(planEndDate.getMinutes() + plan.durationMinutes * multiplier);
        else if (plan.durationHours) planEndDate.setHours(planEndDate.getHours() + plan.durationHours * multiplier);
        else planEndDate.setDate(startDate.getDate() + (plan.durationDays || 30) * multiplier);

        const paymentStatus = balanceAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "pending";

        const newMember = new EntertainmentMember({
            memberId, poolId, name, phone,
            dob: dob ? new Date(dob) : undefined,
            age, aadharCard, address, photoUrl, planId,
            planQuantity: multiplier, planStartDate: startDate, planEndDate,
            paidAmount, balanceAmount, paymentStatus,
            qrCodeUrl, qrToken, isActive: true, isExpired: false, isDeleted: false,
        });

        await newMember.save();
        const saved = await EntertainmentMember.findById(newMember._id)
            .populate("planId", "name hasTokenPrint price")
            .select("memberId name phone planId planQuantity planStartDate planEndDate paidAmount balanceAmount paymentStatus photoUrl qrCodeUrl")
            .lean();
        return NextResponse.json(saved, { status: 201 });
    } catch (error) {
        console.error("[POST /api/entertainment-members]", error);
        return NextResponse.json({ error: "Server error creating entertainment member" }, { status: 500 });
    }
}
