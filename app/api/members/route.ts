import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import QRCode from "qrcode";
import crypto from "crypto";
import { uploadBase64Image, uploadBuffer } from "@/lib/cloudinary";

// Utility to generate the next Member ID for a specific pool
async function getNextMemberId(poolId: string) {
    const lastMember = await Member.findOne({ poolId }, { memberId: 1 }).sort({ createdAt: -1 });
    if (!lastMember || !lastMember.memberId) {
        return "M0001";
    }
    const currentId = parseInt(lastMember.memberId.replace("M", ""));
    const nextId = currentId + 1;
    return `M${nextId.toString().padStart(4, "0")}`;
}

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        await connectDB();

        const query: any = { status: { $ne: "deleted" } };
        if (session.user.role !== "superadmin" && session.user.poolId) {
            query.poolId = session.user.poolId;
        }

        const members = await Member.find(query)
            .populate("planId", "name durationDays price voiceAlert")
            .sort({ createdAt: -1 });

        return NextResponse.json(members);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { name, phone, dob, planId, photoBase64, aadharCard, address } = body;

        if (!name || !phone || !planId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        await connectDB();

        // Auto calculate age if dob is provided
        let age = undefined;
        if (dob) {
            const birthDate = new Date(dob);
            const today = new Date();
            age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
        }

        const poolId = session.user.role !== "superadmin" ? session.user.poolId : body.poolId;

        // Generate Member ID specific to this pool
        const memberId = await getNextMemberId(poolId);

        // Upload photo to Cloudinary
        let photoUrl = "";
        if (photoBase64) {
            photoUrl = await uploadBase64Image(
                photoBase64,
                "swimming-pool/photos",
                `${poolId}_${memberId}_photo`
            );
        }

        // Generate QR Code and upload to Cloudinary
        const qrToken = crypto.randomUUID();
        const qrPngBuffer = await QRCode.toBuffer(`${memberId}:${qrToken}`, { width: 300 });
        const qrCodeUrl = await uploadBuffer(
            qrPngBuffer,
            "swimming-pool/qrcodes",
            `${poolId}_${memberId}_qr`
        );

        // Validate plan
        const { Plan } = await import("@/models/Plan");
        const plan = await Plan.findById(planId);
        if (!plan) return NextResponse.json({ error: "Invalid Plan" }, { status: 400 });

        const startDate = new Date();
        const expiryDate = new Date();

        if (plan.durationSeconds) {
            expiryDate.setSeconds(expiryDate.getSeconds() + plan.durationSeconds);
        } else if (plan.durationMinutes) {
            expiryDate.setMinutes(expiryDate.getMinutes() + plan.durationMinutes);
        } else if (plan.durationHours) {
            expiryDate.setHours(expiryDate.getHours() + plan.durationHours);
        } else {
            expiryDate.setDate(startDate.getDate() + (plan.durationDays || 30));
        }

        const newMember = new Member({
            memberId,
            poolId,
            name,
            phone,
            dob: dob ? new Date(dob) : undefined,
            age,
            aadharCard,
            address,
            photoUrl,
            planId,
            planQuantity: 1,
            totalEntriesAllowed: 1,
            entriesUsed: 0,
            startDate,
            expiryDate,
            qrCodeUrl,
            qrToken,
            status: "active",
        });

        await newMember.save();

        return NextResponse.json(newMember, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Server error creating member" }, { status: 500 });
    }
}
