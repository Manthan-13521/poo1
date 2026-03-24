import mongoose, { Document, Model, Schema } from "mongoose";

export interface IUser extends Document {
    name: string;
    email: string;
    passwordHash: string;
    role: "superadmin" | "admin" | "operator";
    poolId?: string;
    isActive: boolean;
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema = new Schema<IUser>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        passwordHash: { type: String, required: true },
        poolId: { type: String, index: true, sparse: true },
        role: {
            type: String,
            enum: ["superadmin", "admin", "operator"],
            default: "operator",
        },
        isActive: { type: Boolean, default: true },
        lastLogin: { type: Date },
    },
    { timestamps: true }
);

userSchema.index({ name: 1 });
userSchema.index({ email: 1, poolId: 1 });
userSchema.index({ name: 1, poolId: 1 });
userSchema.index({ poolId: 1, role: 1 });

export const User: Model<IUser> =
    mongoose.models.User || mongoose.model<IUser>("User", userSchema);
