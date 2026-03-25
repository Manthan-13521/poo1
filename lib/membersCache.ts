import { redis } from "./redis";

/**
 * Hybrid cache: Upstash Redis (production) with in-memory fallback (dev).
 * TTL: 10 seconds for member list responses.
 */

const CACHE_TTL = 10; // seconds
const CACHE_PREFIX = "members:";

// ── In-memory fallback (for dev without Redis) ───────────────────────
interface MemCacheEntry { data: unknown; expiry: number }
const memCache = new Map<string, MemCacheEntry>();

// ── GET ──────────────────────────────────────────────────────────────
export async function getCache(key: string): Promise<unknown | null> {
    const fullKey = CACHE_PREFIX + key;

    // Try Redis first
    if (redis) {
        try {
            const cached = await redis.get(fullKey);
            if (cached) return cached;
        } catch (err) {
            console.warn("[Cache] Redis GET failed, falling back to memory:", err);
        }
    }

    // In-memory fallback
    const entry = memCache.get(fullKey);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        memCache.delete(fullKey);
        return null;
    }
    return entry.data;
}

// ── SET ──────────────────────────────────────────────────────────────
export async function setCache(key: string, data: unknown): Promise<void> {
    const fullKey = CACHE_PREFIX + key;

    // Try Redis
    if (redis) {
        try {
            await redis.set(fullKey, JSON.stringify(data), { ex: CACHE_TTL });
            return;
        } catch (err) {
            console.warn("[Cache] Redis SET failed, falling back to memory:", err);
        }
    }

    // In-memory fallback
    memCache.set(fullKey, { data, expiry: Date.now() + CACHE_TTL * 1000 });
    // Evict oldest if too many entries
    if (memCache.size > 200) {
        const firstKey = memCache.keys().next().value;
        if (firstKey) memCache.delete(firstKey);
    }
}

// ── INVALIDATE ──────────────────────────────────────────────────────
export async function invalidateCache(poolId?: string): Promise<void> {
    // Clear in-memory
    if (!poolId) {
        memCache.clear();
    } else {
        const prefix = CACHE_PREFIX + `members-${poolId}`;
        for (const k of memCache.keys()) {
            if (k.startsWith(prefix)) memCache.delete(k);
        }
    }

    // Clear Redis — scan and delete matching keys
    if (redis) {
        try {
            const pattern = poolId
                ? `${CACHE_PREFIX}members-${poolId}*`
                : `${CACHE_PREFIX}*`;

            // Use scan to find all matching keys
            let cursor = 0;
            do {
                const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
                cursor = Number(nextCursor);
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
            } while (cursor !== 0);
        } catch (err) {
            console.warn("[Cache] Redis invalidation failed:", err);
        }
    }
}
