/**
 * Simple in-memory TTL cache for API responses.
 * Avoids hitting MongoDB on every paginated request.
 * TTL = 10 seconds — short enough to stay fresh, long enough to absorb bursts.
 */

interface CacheEntry {
    data: unknown;
    expiry: number;
}

const cache = new Map<string, CacheEntry>();
const TTL = 10_000; // 10 seconds

export function getCache(key: string): unknown | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

export function setCache(key: string, data: unknown): void {
    cache.set(key, { data, expiry: Date.now() + TTL });

    // Prevent unbounded growth — evict oldest entries if cache exceeds 200 keys
    if (cache.size > 200) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
    }
}

export function invalidateCache(prefix?: string): void {
    if (!prefix) {
        cache.clear();
        return;
    }
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
}
