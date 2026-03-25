import mongoose, { Document, Model, Schema } from "mongoose";
import crypto from "crypto";

// Entertainment members use MS0001 format instead of M0001
// Stored in 'entertainment_members' collection (separate from regular members)

export interface IEntertainmentMember extends Document {
    memberId: string; // MS0001, MS0002, ...
    poolId: string;
    name: string;
    phone: string;
    age?: number;
    dob?: Date;
    aadharCard?: string;
    address?: string;
    photoUrl?: string;
    faceDescriptor?: number[];
    faceScanEnabled?: boolean;
    entertainmentFeatures: string[];
    // Plan linkage
    planId: mongoose.Types.ObjectId;
    planQuantity: number;
    planStartDate?: Date;
    planEndDate?: Date;
    // Payment
    paidAmount: number;
    balanceAmount: number;
    paymentStatus: "paid" | "partial" | "pending";
    paymentMode?: string;
    // Equipment
    equipmentTaken: {
        itemName: string;
        issuedDate: Date;
        returnedDate?: Date;
        isReturned: boolean;
    }[];
    // QR
    qrCodeUrl?: string;
    qrToken: string;
    cardStatus?: "pending" | "ready";
    pdfUrl?: string;
    lastScannedAt?: Date;
    // Lifecycle
    isActive: boolean;
    isExpired: boolean;
    expiredAt?: Date;
    isDeleted: boolean;
    deletedAt?: Date;
    deleteReason?: "auto_quick" | "auto_standard" | "manual";
    createdAt: Date;
    updatedAt: Date;
}

const entertainmentMemberSchema = new Schema<IEntertainmentMember>(
    {
        memberId: { type: String, required: true },
        poolId: { type: String, required: true, index: true },
        faceScanEnabled: { type: Boolean, default: false },
        faceDescriptor: { type: [Number] },
        entertainmentFeatures: { type: [String], default: [] },
        name: { type: String, required: true },
        phone: { type: String, required: true },
        age: { type: Number },
        dob: { type: Date },
        aadharCard: { type: String },
        address: { type: String },
        photoUrl: { type: String },
        planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
        planQuantity: { type: Number, default: 1 },
        planStartDate: { type: Date },
        planEndDate: { type: Date, index: true },
        paidAmount: { type: Number, default: 0 },
        balanceAmount: { type: Number, default: 0 },
        paymentStatus: {
            type: String,
            enum: ["paid", "partial", "pending"],
            default: "pending",
        },
        paymentMode: { type: String, default: "cash" },
        equipmentTaken: {
            type: [
                {
                    itemName: String,
                    issuedDate: { type: Date, default: Date.now },
                    returnedDate: Date,
                    isReturned: { type: Boolean, default: false },
                },
            ],
            default: [],
        },
        qrCodeUrl: { type: String },
        qrToken: {
            type: String,
            required: true,
            default: () => crypto.randomUUID(),
        },
        cardStatus: { type: String, enum: ["pending", "ready"], default: "pending" },
        pdfUrl: { type: String },
        lastScannedAt: { type: Date },
        isActive: { type: Boolean, default: true, index: true },
        isExpired: { type: Boolean, default: false, index: true },
        expiredAt: { type: Date },
        isDeleted: { type: Boolean, default: false, index: true },
        deletedAt: { type: Date },
        deleteReason: {
            type: String,
            enum: ["auto_quick", "auto_standard", "manual"],
        },
    },
    { timestamps: true, collection: "entertainment_members" }
);

entertainmentMemberSchema.index({ poolId: 1, memberId: 1 }, { unique: true });
entertainmentMemberSchema.index({ poolId: 1, phone: 1 });
entertainmentMemberSchema.index({ poolId: 1, planId: 1 });
// planId standalone index removed — covered by compound index above
entertainmentMemberSchema.index({ poolId: 1, planEndDate: 1 });
entertainmentMemberSchema.index({ poolId: 1, balanceAmount: 1 });
entertainmentMemberSchema.index({ poolId: 1, createdAt: -1 });
entertainmentMemberSchema.index({ poolId: 1, isDeleted: 1, isExpired: 1 });
entertainmentMemberSchema.index({ poolId: 1, isDeleted: 1 });
entertainmentMemberSchema.index({ createdAt: -1 });
entertainmentMemberSchema.index(
  { name: "text", phone: "text", memberId: "text" },
  { weights: { memberId: 3, name: 2, phone: 1 } }
);

export const EntertainmentMember: Model<IEntertainmentMember> =
    mongoose.models.EntertainmentMember ||
    mongoose.model<IEntertainmentMember>(
        "EntertainmentMember",
        entertainmentMemberSchema
    );
