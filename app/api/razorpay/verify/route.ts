import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Payment } from "@/models/Payment";
import { Plan } from "@/models/Plan";
import crypto from "crypto";
import QRCode from "qrcode";
import { logger } from "@/lib/logger";
import { uploadBuffer } from "@/lib/local-upload";
import { savePhoto } from "@/lib/savePhoto";
import { signQRToken } from "@/lib/qrSigner";

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
                logger.audit({
                    type: "PAYMENT_FAILED",
                    ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
                    meta: { reason: "signature_mismatch", razorpay_order_id },
                });
                return NextResponse.json(
                    { error: "Payment verification failed: Invalid signature" },
                    { status: 400 }
                );
            }
        }

        await dbConnect();

        // Idempotency: prevent duplicate member/payment if same order verified twice
        if (razorpay_order_id && !isMock) {
            const existingPayment = await Payment.findOne({
                razorpayOrderId: razorpay_order_id,
            }).lean();
            if (existingPayment) {
                logger.audit({
                    type: "PAYMENT_DUPLICATE",
                    meta: { razorpay_order_id, razorpay_payment_id },
                });
                const existingMember = await Member.findById(existingPayment.memberId).lean();
                if (existingMember) {
                    return NextResponse.json({
                        message: "Registration already processed",
                        dbId: (existingMember._id as any).toString(),
                        memberId: existingMember.memberId,
                    });
                }
            }
        }

        // Duplicate payment ID check (prevents replay attacks)
        if (razorpay_payment_id && !isMock) {
            const dupByPaymentId = await Payment.findOne({ transactionId: razorpay_payment_id }).lean();
            if (dupByPaymentId) {
                logger.audit({
                    type: "PAYMENT_DUPLICATE",
                    meta: { reason: "duplicate_payment_id", razorpay_payment_id },
                });
                return NextResponse.json(
                    { error: "Duplicate payment — this transaction has already been processed." },
                    { status: 400 }
                );
            }
        }

        const plan = await Plan.findById(memberData.planId).lean();
        if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

        // ── CRITICAL: Validate payment amount matches plan price from DB ──
        const quantity = memberData.cartQuantity || 1;
        const expectedAmount = plan.price * quantity;
        if (memberData.amount && Math.abs(memberData.amount - expectedAmount) > 1) {
            logger.audit({
                type: "PAYMENT_FAILED",
                meta: {
                    reason: "amount_mismatch",
                    clientAmount: memberData.amount,
                    expectedAmount,
                    planId: memberData.planId,
                },
            });
            return NextResponse.json(
                { error: "Payment amount does not match plan price. Possible tampering detected." },
                { status: 400 }
            );
        }

        // Generate Member ID locally scoped to the tenant pool
        const lastMember = await Member.findOne({ poolId: plan.poolId }).sort({ createdAt: -1 }).lean();
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
        if (plan.durationSeconds) {
            expiryDate.setSeconds(expiryDate.getSeconds() + plan.durationSeconds);
        } else if (plan.durationMinutes) {
            expiryDate.setMinutes(expiryDate.getMinutes() + (plan.durationMinutes || 0));
        } else if (plan.durationHours) {
            expiryDate.setHours(expiryDate.getHours() + (plan.durationHours || 0));
        } else {
            expiryDate.setDate(expiryDate.getDate() + (plan.durationDays || 30));
        }

        // Upload photo locally
        let photoUrl = "";
        if (memberData.photoBase64) {
            photoUrl = await savePhoto(memberData.photoBase64);
        }

        // Generate Secure JWT QR and upload to Cloudinary (or local depending on uploadBuffer implementation)
        const qrToken = crypto.randomUUID();
        const qrPayloadObject = await signQRToken(generatedMemberId);
        const qrPngBuffer = await QRCode.toBuffer(qrPayloadObject, { width: 300 });
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

        logger.audit({
            type: "PAYMENT_SUCCESS",
            poolId: plan.poolId,
            meta: {
                memberId: generatedMemberId,
                plan: plan.name,
                amount: plan.price * quantity,
                razorpay_payment_id,
                razorpay_order_id,
            },
        });

        // WhatsApp notification (via dispatcher for future BullMQ readiness)
        try {
            const { dispatchJob } = await import("@/lib/queueAdapter");
            await dispatchJob("SEND_WELCOME_WHATSAPP", {
                memberName: memberData.name,
                memberId: generatedMemberId,
                phone: newMember.phone,
                poolId: plan.poolId,
            });
        } catch (notifyErr: any) {
            // Non-critical — don't fail the registration if notification fails
            console.warn("[Razorpay Verify] Welcome notification failed:", notifyErr?.message);
        }

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
