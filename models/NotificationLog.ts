import mongoose, { Document, Model, Schema } from "mongoose";

export interface INotificationLog extends Document {
    memberId: mongoose.Types.ObjectId;
    poolId?: string;
    type: "whatsapp" | "sms" | "email";
    message: string;
    status: "sent" | "failed";
    errorDetails?: string;
    date: Date;
    sentAt?: Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
    {
        memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
        poolId: { type: String, index: true, sparse: true },
        type: { type: String, enum: ["whatsapp", "sms", "email"], required: true },
        message: { type: String, required: true },
        status: { type: String, enum: ["sent", "failed"], required: true },
        errorDetails: { type: String },
        date: { type: Date, default: Date.now, index: true },
        sentAt: { type: Date, index: true },
    },
    { timestamps: true }
);

// Section 2D — performance indexes
notificationLogSchema.index({ memberId: 1 });
notificationLogSchema.index({ date: -1 });  // sentAt equivalent
notificationLogSchema.index({ status: 1 });
// TTL: auto-delete logs older than 6 months — prevents Atlas free tier storage bloat
notificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

export const NotificationLog: Model<INotificationLog> =
    mongoose.models.NotificationLog || mongoose.model<INotificationLog>("NotificationLog", notificationLogSchema);
