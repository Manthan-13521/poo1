import mongoose, { Document, Model, Schema } from "mongoose";

export interface IPayment extends Document {
    memberId: mongoose.Types.ObjectId;
    poolId: string;
    planId: mongoose.Types.ObjectId;
    memberCollection: "members" | "entertainment_members";
    amount: number;
    paymentMethod: "cash" | "upi" | "razorpay_online";
    transactionId?: string;
    razorpayOrderId?: string;
    idempotencyKey?: string; // Prevents duplicate payment submissions
    date: Date;
    paidAt?: Date;
    status: "success" | "pending" | "failed" | "refunded";
    recordedBy?: mongoose.Types.ObjectId;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
    {
        memberId: {
            type: Schema.Types.ObjectId,
            ref: "Member",
            required: true,
            index: true,
        },
        poolId: { type: String, index: true, required: true },
        planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
        memberCollection: {
            type: String,
            enum: ["members", "entertainment_members"],
            default: "members",
        },
        amount: { type: Number, required: true, min: 0 },
        paymentMethod: {
            type: String,
            enum: ["cash", "upi", "razorpay_online"],
            required: true,
        },
        transactionId: { type: String },
        razorpayOrderId: { type: String, sparse: true },
        // Fix #11 — idempotency key prevents duplicate payment submissions
        idempotencyKey: { type: String, sparse: true },
        date: { type: Date, default: Date.now, index: true },
        paidAt: { type: Date, index: true },
        status: {
            type: String,
            enum: ["success", "pending", "failed", "refunded"],
            default: "success",
        },
        recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
        notes: { type: String },
    },
    { timestamps: true }
);

// Unique idempotency key (sparse — only enforced when set)
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
// Sparse unique index for Razorpay orders
paymentSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
// Compound query indexes
paymentSchema.index({ poolId: 1, createdAt: -1 });
paymentSchema.index({ poolId: 1, memberId: 1 });

// Section 2C — additional performance indexes
paymentSchema.index({ memberId: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ paymentMethod: 1 });
paymentSchema.index({ poolId: 1, status: 1, date: -1 });

export const Payment: Model<IPayment> =
    mongoose.models.Payment || mongoose.model<IPayment>("Payment", paymentSchema);
