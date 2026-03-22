import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Payment } from "@/models/Payment";
import { Member } from "@/models/Member";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import mongoose from "mongoose";
import { PaymentSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments
 * Returns paginated payments for the admin's pool.
 * Supports: ?page=1&limit=20&memberId=<id>&method=cash|upi|razorpay_online
 */
export async function GET(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(req.url);
        const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
        const skip  = (page - 1) * limit;

        const query: Record<string, unknown> = {};

        // Pool isolation — superadmin sees all unless filtered
        if (session.user.role !== "superadmin" && session.user.poolId) {
            query.poolId = session.user.poolId;
        }

        // Optional filters
        const memberIdParam = url.searchParams.get("memberId");
        if (memberIdParam) query.memberId = new mongoose.Types.ObjectId(memberIdParam);

        const methodParam = url.searchParams.get("method");
        if (methodParam) query.paymentMethod = methodParam;

        const statusParam = url.searchParams.get("status");
        if (statusParam) query.status = statusParam;

        const [payments, total] = await Promise.all([
            Payment.find(query)
                .populate("memberId", "name memberId")
                .populate("planId",   "name")
                .populate("recordedBy", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(query),
        ]);

        return NextResponse.json({
            data: payments,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        }, {
            headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
        });
    } catch (error) {
        console.error("[GET /api/payments]", error);
        return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
    }
}

/**
 * POST /api/payments
 * Records a manual payment and updates member balance.
 * Idempotency: pass `idempotencyKey` to prevent duplicate submissions.
 */
export async function POST(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const result = PaymentSchema.safeParse(body);
        if (!result.success) {
            return NextResponse.json(
                { error: result.error.flatten() },
                { status: 400 }
            );
        }
        
        const {
            memberId,
            planId,
            amount,
            paymentMethod,
            transactionId,
            notes,
            idempotencyKey,
            memberCollection,
        } = result.data;
        if (paymentMethod === "upi" && !transactionId) {
            return NextResponse.json(
                { error: "UPI payments require a transactionId" },
                { status: 400 }
            );
        }

        // ── Idempotency check ──────────────────────────────────────────────
        if (idempotencyKey) {
            const existing = await Payment.findOne({ idempotencyKey }).lean();
            if (existing) {
                return NextResponse.json(
                    { message: "Duplicate request — payment already recorded.", payment: existing },
                    { status: 200 }
                );
            }
        }

        const poolId =
            session.user.role !== "superadmin"
                ? session.user.poolId
                : body.poolId;

        if (!poolId) {
            return NextResponse.json({ error: "Pool ID required" }, { status: 400 });
        }

        // ── Save payment ───────────────────────────────────────────────────
        const payment = new Payment({
            memberId:         new mongoose.Types.ObjectId(memberId as string),
            planId:           new mongoose.Types.ObjectId(planId  as string),
            poolId,
            memberCollection,
            amount:           Number(amount),
            paymentMethod,
            transactionId:    transactionId  || undefined,
            notes:            notes          || undefined,
            idempotencyKey:   idempotencyKey || undefined,
            recordedBy:       new mongoose.Types.ObjectId(session.user.id),
            status:           "success",
        });

        await payment.save();

        // ── Update member balance ──────────────────────────────────────────
        let memberToUpdate: any = await Member.findById(memberId);
        if (!memberToUpdate) {
            const { EntertainmentMember } = await import("@/models/EntertainmentMember");
            memberToUpdate = await EntertainmentMember.findById(memberId);
        }

        if (memberToUpdate) {
            const newBalance = Math.max(0, (memberToUpdate.balanceAmount ?? 0) - Number(amount));
            memberToUpdate.balanceAmount = newBalance;
            memberToUpdate.paidAmount    = (memberToUpdate.paidAmount ?? 0) + Number(amount);
            memberToUpdate.paymentStatus = newBalance <= 0 ? "paid" : "partial";
            await memberToUpdate.save();
        }

        return NextResponse.json(payment, { status: 201 });
    } catch (error: any) {
        // MongoDB duplicate key (idempotency unique index collision)
        if (error?.code === 11000 && error?.keyPattern?.idempotencyKey) {
            const existing = await Payment.findOne({ idempotencyKey: error.keyValue?.idempotencyKey }).lean();
            return NextResponse.json(
                { message: "Duplicate request — payment already recorded.", payment: existing },
                { status: 200 }
            );
        }
        console.error("[POST /api/payments]", error);
        return NextResponse.json({ error: "Server error recording payment" }, { status: 500 });
    }
}
