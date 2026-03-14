import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Payment } from "@/models/Payment";
import { Plan } from "@/models/Plan";
import crypto from "crypto";
import QRCode from "qrcode";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { logger } from "@/lib/logger";
import { uploadBase64Image, uploadBuffer } from "@/lib/cloudinary";

export async function POST(req: Request) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, memberData, isMock } =
            await req.json();

        if (!memberData || !memberData.planId) {
            return NextResponse.json({ error: "Missing member registration data" }, { status: 400 });
        }

        // Verify Razorpay signature (skip in mock/test mode)
        if (!isMock) {
            const secret = process.env.RAZORPAY_KEY_SECRET;
            if (!secret)
                return NextResponse.json({ error: "Server misconfiguration: missing secret" }, { status: 500 });

            const generated_signature = crypto
                .createHmac("sha256", secret)
                .update(razorpay_order_id + "|" + razorpay_payment_id)
                .digest("hex");

            if (generated_signature !== razorpay_signature) {
                logger.error("Razorpay signature mismatch", { razorpay_order_id });
                return NextResponse.json(
                    { error: "Payment verification failed: Invalid signature" },
                    { status: 400 }
                );
            }
        }

        await connectDB();

        // Idempotency: prevent duplicate member/payment if same order verified twice
        if (razorpay_order_id && !isMock) {
            const existingPayment = await Payment.findOne({
                razorpayOrderId: razorpay_order_id,
            }).lean();
            if (existingPayment) {
                const existingMember = await Member.findById(existingPayment.memberId).lean();
                if (existingMember) {
                    logger.info("Razorpay idempotency hit", { razorpay_order_id });
                    return NextResponse.json({
                        message: "Registration already processed",
                        dbId: (existingMember._id as any).toString(),
                        memberId: existingMember.memberId,
                    });
                }
            }
        }

        const plan = await Plan.findById(memberData.planId);
        if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

        // Generate Member ID locally scoped to the tenant pool
        const lastMember = await Member.findOne({ poolId: plan.poolId }).sort({ createdAt: -1 });
        let newIdNum = 1;
        if (lastMember && lastMember.memberId.startsWith("M")) {
            newIdNum = parseInt(lastMember.memberId.replace("M", "")) + 1;
        }
        const generatedMemberId = `M${newIdNum.toString().padStart(4, "0")}`;

        // Age & DOB
        const dob = memberData.dob ? new Date(memberData.dob) : new Date();
        let age = parseInt(memberData.age);
        if (isNaN(age) && dob) age = new Date().getFullYear() - dob.getFullYear();
        if (isNaN(age)) age = 0;

        // Expiry calculation
        const startDate = new Date();
        const expiryDate = new Date();
        const quantity = memberData.cartQuantity || 1;
        if (plan.durationSeconds) {
            expiryDate.setSeconds(expiryDate.getSeconds() + plan.durationSeconds);
        } else if (plan.durationMinutes) {
            expiryDate.setMinutes(expiryDate.getMinutes() + (plan.durationMinutes || 0));
        } else if (plan.durationHours) {
            expiryDate.setHours(expiryDate.getHours() + (plan.durationHours || 0));
        } else {
            expiryDate.setDate(expiryDate.getDate() + (plan.durationDays || 30));
        }

        // Upload photo to Cloudinary
        let photoUrl = "";
        if (memberData.photoBase64) {
            photoUrl = await uploadBase64Image(
                memberData.photoBase64,
                "swimming-pool/photos",
                `${plan.poolId}_${generatedMemberId}_photo`
            );
        }

        // Generate QR and upload to Cloudinary
        const qrToken = crypto.randomUUID();
        const qrPngBuffer = await QRCode.toBuffer(`${generatedMemberId}:${qrToken}`, { width: 300 });
        const qrCodeUrl = await uploadBuffer(
            qrPngBuffer,
            "swimming-pool/qrcodes",
            `${plan.poolId}_${generatedMemberId}_qr`
        );

        // Create Member
        const newMember = new Member({
            memberId: generatedMemberId,
            poolId: plan.poolId,
            name: memberData.name,
            dob,
            age,
            phone: memberData.phone || "Unknown",
            aadharCard: memberData.aadharCard || "",
            address: memberData.address || "",
            planId: plan._id,
            planQuantity: quantity,
            totalEntriesAllowed: quantity,
            entriesUsed: 0,
            startDate,
            expiryDate,
            status: "active",
            photoUrl,
            qrCodeUrl,
            qrToken,
        });
        await newMember.save();

        // Record Payment
        const payment = new Payment({
            memberId: newMember._id,
            poolId: plan.poolId,
            planId: plan._id,
            amount: plan.price * quantity,
            paymentMethod: "razorpay_online",
            transactionId: razorpay_payment_id || `mock_${Date.now()}`,
            razorpayOrderId: razorpay_order_id || undefined,
            status: "success",
        });
        await payment.save();

        logger.info("Member registered via Razorpay", {
            memberId: generatedMemberId,
            plan: plan.name,
            amount: plan.price * quantity,
        });

        // WhatsApp notification
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        const idCardUrl = `${baseUrl}/api/members/${generatedMemberId}/pdf`;
        const welcomeMessage = `Hello ${memberData.name}! Your registration is successful. ID Card: ${idCardUrl}\n\n- TS Pools Mgmt`;
        await sendWhatsAppMessage(newMember.phone, welcomeMessage);

        return NextResponse.json({
            message: "Registration successful",
            dbId: newMember._id.toString(),
            memberId: generatedMemberId,
        });
    } catch (error: any) {
        logger.error("Razorpay verify error", { error: error?.message });
        return NextResponse.json(
            { error: error?.message || "Failed to verify and save registration" },
            { status: 500 }
        );
    }
}
