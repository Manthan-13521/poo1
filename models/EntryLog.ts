import mongoose, { Document, Model, Schema } from "mongoose";

export interface IEntryLog extends Document {
    memberId: mongoose.Types.ObjectId;
    poolId: string;
    memberCollection: "members" | "entertainment_members";
    entryType: "qr" | "face";
    scanTime: Date;
    entryTime?: Date;
    status: "granted" | "denied";
    isValid: boolean;
    reason?: string;
    failReason?: "expired" | "not_found" | "face_mismatch";
    operatorId?: mongoose.Types.ObjectId;
    deviceId?: string;
    qrToken?: string;
    rawPayload?: string;
    numPersons: number;
    createdAt: Date;
    updatedAt: Date;
}

const entryLogSchema = new Schema<IEntryLog>(
    {
        memberId: { type: Schema.Types.ObjectId, ref: "Member", index: true },
        poolId: { type: String, required: true, index: true },
        memberCollection: {
            type: String,
            enum: ["members", "entertainment_members"],
            default: "members",
        },
        entryType: { type: String, enum: ["qr", "face"], default: "qr" },
        scanTime: { type: Date, default: Date.now },
        entryTime: { type: Date, index: true },
        status: { type: String, enum: ["granted", "denied"], required: true },
        isValid: { type: Boolean, default: false },
        reason: { type: String },
        failReason: {
            type: String,
            enum: ["expired", "not_found", "face_mismatch"],
        },
        operatorId: { type: Schema.Types.ObjectId, ref: "User" },
        deviceId: { type: String },
        qrToken: { type: String },
        rawPayload: { type: String },
        numPersons: { type: Number, default: 1 },
    },
    { timestamps: true }
);

// Fix #10 — compound indexes for fast entry log queries
entryLogSchema.index({ poolId: 1, memberId: 1, createdAt: -1 });
entryLogSchema.index({ poolId: 1, createdAt: -1 });
entryLogSchema.index({ poolId: 1, scanTime: 1 });
entryLogSchema.index({ memberId: 1, scanTime: -1 }); // kept for cooldown checks

// Section 2B — additional indexes
entryLogSchema.index({ memberId: 1, createdAt: -1 });
entryLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 }); // TTL: auto-delete after 1 year

export const EntryLog: Model<IEntryLog> =
    mongoose.models.EntryLog ||
    mongoose.model<IEntryLog>("EntryLog", entryLogSchema);
