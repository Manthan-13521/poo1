import mongoose, { Document, Model, Schema } from "mongoose";
import crypto from "crypto";

export interface IEquipmentItem {
    itemName: string;
    issuedDate: Date;
    returnedDate?: Date;
    isReturned: boolean;
}

export interface IMember extends Document {
    memberId: string;
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
    // Plan linkage
    planId: mongoose.Types.ObjectId;
    planQuantity: number;
    planStartDate?: Date;
    planEndDate?: Date;
    cardStatus: "pending" | "ready";
    // Kept for backward compat
    startDate?: Date;
    expiryDate?: Date;
    totalEntriesAllowed?: number;
    entriesUsed?: number;
    // Payment status
    paidAmount: number;
    balanceAmount: number;
    paymentStatus: "paid" | "partial" | "pending";
    paymentMode?: string;
    // Equipment
    equipmentTaken: IEquipmentItem[];
    // QR
    qrCodeUrl?: string;
    qrToken: string;
    lastScannedAt?: Date;
    // Lifecycle
    isActive: boolean;
    isExpired: boolean;
    expiredAt?: Date;
    isDeleted: boolean;
    deletedAt?: Date;
    deleteReason?: "auto_quick" | "auto_standard" | "manual";
    // Legacy status field (kept for compat)
    status: "active" | "expired" | "deleted";
    deletedAtLegacy?: Date;
    createdAt: Date;
    updatedAt: Date;
    rotateQrToken(): Promise<string>;
}

const equipmentItemSchema = new Schema<IEquipmentItem>(
    {
        itemName: { type: String, required: true },
        issuedDate: { type: Date, required: true, default: Date.now },
        returnedDate: { type: Date },
        isReturned: { type: Boolean, default: false },
    },
    { _id: true }
);

const memberSchema = new Schema<IMember>(
    {
        memberId: { type: String, required: true, index: true },
        poolId: { type: String, required: true, index: true },
        faceScanEnabled: { type: Boolean, default: false },
        faceDescriptor: { type: [Number] },
        name: { type: String, required: true },
        phone: { type: String, required: true },
        age: { type: Number },
        dob: { type: Date },
        aadharCard: { type: String },
        address: { type: String },
        photoUrl: { type: String }, // Cloudinary URL only — never base64
        planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
        planQuantity: { type: Number, default: 1 },
        planStartDate: { type: Date },
        planEndDate: { type: Date, index: true },
        // Backward compat aliases
        startDate: { type: Date },
        expiryDate: { type: Date, index: true },
        totalEntriesAllowed: { type: Number, default: 1 },
        entriesUsed: { type: Number, default: 0 },
        // Payment
        paidAmount: { type: Number, default: 0 },
        balanceAmount: { type: Number, default: 0 },
        paymentStatus: {
            type: String,
            enum: ["paid", "partial", "pending"],
            default: "pending",
        },
        paymentMode: { type: String, default: "cash" },
        // Equipment issued to member
        equipmentTaken: { type: [equipmentItemSchema], default: [] },
        // QR
        qrCodeUrl: { type: String },
        qrToken: {
            type: String,
            required: true,
            default: () => crypto.randomUUID(),
        },
        cardStatus: { 
            type: String, 
            enum: ['pending', 'ready'], 
            default: 'pending',
            index: true
        },
        lastScannedAt: { type: Date },
        // Lifecycle — new boolean model (replaces status string)
        isActive: { type: Boolean, default: true, index: true },
        isExpired: { type: Boolean, default: false, index: true },
        expiredAt: { type: Date },
        isDeleted: { type: Boolean, default: false, index: true },
        deletedAt: { type: Date },
        deleteReason: {
            type: String,
            enum: ["auto_quick", "auto_standard", "manual"],
        },
        // Legacy status (kept for backward compat with existing code)
        status: {
            type: String,
            enum: ["active", "expired", "deleted"],
            default: "active",
            index: true,
        },
        deletedAtLegacy: { type: Date },
    },
    { timestamps: true }
);

// ── Compound indexes ──────────────────────────────────────────────────
memberSchema.index({ poolId: 1, memberId: 1 }, { unique: true });
memberSchema.index({ poolId: 1, phone: 1 });
memberSchema.index({ poolId: 1, planId: 1 });
memberSchema.index({ poolId: 1, planEndDate: 1 });
memberSchema.index({ poolId: 1, balanceAmount: 1 });
memberSchema.index({ poolId: 1, createdAt: -1 });
memberSchema.index({ poolId: 1, isDeleted: 1, isExpired: 1 });
memberSchema.index({ poolId: 1, isDeleted: 1 });

// ── Section 2A — additional performance indexes ─────────────────────
memberSchema.index({ createdAt: -1 });
memberSchema.index(
  { name: "text", phone: "text", memberId: "text" },
  { weights: { memberId: 3, name: 2, phone: 1 } }
);
memberSchema.index({ planId: 1 });
// TODO: migrate photoUrl from base64 to URL after running photo migration script

// ── Method: rotate QR token after each successful scan ───────────────
memberSchema.methods.rotateQrToken = async function () {
    this.qrToken = crypto.randomUUID();
    await this.save();
    return this.qrToken;
};

export const Member: Model<IMember> =
    mongoose.models.Member || mongoose.model<IMember>("Member", memberSchema);
