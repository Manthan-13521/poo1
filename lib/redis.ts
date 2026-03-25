import { Redis } from "@upstash/redis";

/**
 * Upstash Redis client.
 * Falls back gracefully if env vars are missing (dev mode).
 */
let redis: Redis | null = null;

try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    }
} catch (err) {
    console.warn("[Redis] Failed to initialize Upstash Redis:", err);
}

export { redis };
