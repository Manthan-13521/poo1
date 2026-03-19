import mongoose from "mongoose";

declare global {
    // Preserve connection across hot reloads in Next.js dev mode
    // eslint-disable-next-line no-var
    var _mongoCache: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error(
        "[MongoDB] MONGODB_URI is not set. Add it to your .env.local file."
    );
}

let cached = global._mongoCache;

if (!cached) {
    cached = global._mongoCache = { conn: null, promise: null };
}

async function connectDB(): Promise<typeof mongoose> {
    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts: mongoose.ConnectOptions = {
            bufferCommands: false,
            connectTimeoutMS: 15000,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        };

        cached.promise = mongoose
            .connect(MONGODB_URI!, opts)
            .then((mongooseInstance) => mongooseInstance)
            .catch((err) => {
                // Reset so next call retries
                cached.promise = null;
                throw err;
            });
    }

    try {
        cached.conn = await cached.promise;
    } catch (err) {
        cached.promise = null;
        throw err;
    }

    return cached.conn;
}

export default connectDB;
