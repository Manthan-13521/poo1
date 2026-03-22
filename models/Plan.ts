import mongoose, { Document, Model, Schema } from "mongoose";

export interface IPlan extends Document {
    name: string;
    poolId: string;
    durationDays?: number;
    durationHours?: number;
    durationMinutes?: number;
    durationSeconds?: number;
    price: number;
    description?: string;
    features: string[];
    // Feature checkboxes
    hasEntertainment: boolean;   // MS0001 ID format
    hasFaceScan: boolean;        // Require face scan at entry
    quickDelete: boolean;        // Delete 1 day after expiry (vs 15 days)
    hasTokenPrint: boolean;      // Auto-print thermal receipt on join
    // Alerts
    whatsAppAlert?: boolean;
    voiceAlert?: boolean;
    allowQuantity?: boolean;
    // Atomic ID counters — incremented via $inc to prevent race conditions
    memberCounter: number;
    entertainmentMemberCounter: number;
    // Group QR
    groupToken?: string | null;
    maxEntriesPerQR?: number;
    remainingEntries?: number;
    isActive: boolean;
    deletedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const planSchema = new Schema<IPlan>(
    {
        name: { type: String, required: true },
        poolId: { type: String, required: true, index: true },
        durationDays: { type: Number, min: 0 },
        durationHours: { type: Number, min: 0 },
        durationMinutes: { type: Number, min: 0 },
        durationSeconds: { type: Number, min: 0 },
        price: { type: Number, required: true, min: 0 },
        description: { type: String },
        features: { type: [String], default: [] },
        // Feature checkboxes (new)
        hasEntertainment: { type: Boolean, default: false },
        hasFaceScan: { type: Boolean, default: false },
        quickDelete: { type: Boolean, default: false },
        hasTokenPrint: { type: Boolean, default: false },
        // Alerts
        whatsAppAlert: { type: Boolean, default: false },
        allowQuantity: { type: Boolean, default: false },
        voiceAlert: { type: Boolean, default: false },
        // Atomic counters for member ID assignment — never use findOne+sort
        memberCounter: { type: Number, default: 0 },
        entertainmentMemberCounter: { type: Number, default: 0 },
        // Group QR
        groupToken: { type: String, default: null },
        maxEntriesPerQR: { type: Number, default: 1 },
        remainingEntries: { type: Number, default: 1 },
        isActive: { type: Boolean, default: true },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

planSchema.index({ poolId: 1, isActive: 1 });
planSchema.index({ isActive: 1 }); // Section 2E
planSchema.index({ createdAt: -1 });

export const Plan: Model<IPlan> =
    mongoose.models.Plan || mongoose.model<IPlan>("Plan", planSchema);
