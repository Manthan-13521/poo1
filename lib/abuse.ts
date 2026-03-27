/**
 * Abuse Detection System
 *
 * Tracks request patterns per user+IP key.
 * If a key exceeds a threshold within a time window, it's flagged as abusive.
 *
 * Uses in-memory Map with automatic cleanup for edge/serverless compatibility.
 * When Upstash Redis is configured, can be swapped to Redis-backed counters
 * for multi-instance support.
 */

interface AbuseRecord {
    count: number;
    windowStart: number;
    blocked: boolean;
    blockedUntil: number;
}

const abuseMap = new Map<string, AbuseRecord>();

const ABUSE_WINDOW_MS = 5 * 60 * 1000;     // 5-minute detection window
const ABUSE_THRESHOLD = 200;                 // Max requests per window
const BLOCK_DURATION_MS = 15 * 60 * 1000;   // 15-minute block

// Cleanup stale entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of abuseMap.entries()) {
        if (now > record.windowStart + ABUSE_WINDOW_MS && !record.blocked) {
            abuseMap.delete(key);
        }
        if (record.blocked && now > record.blockedUntil) {
            abuseMap.delete(key);
        }
    }
}, 10 * 60 * 1000);

/**
 * Detect abusive request patterns.
 * @returns true if the key is exhibiting abuse (should be blocked)
 */
export function detectAbuse(key: string): boolean {
    const now = Date.now();
    const record = abuseMap.get(key);

    // If currently blocked, check if block has expired
    if (record?.blocked) {
        if (now > record.blockedUntil) {
            abuseMap.delete(key);
            return false;
        }
        return true; // Still blocked
    }

    if (!record || now > record.windowStart + ABUSE_WINDOW_MS) {
        // New window
        abuseMap.set(key, { count: 1, windowStart: now, blocked: false, blockedUntil: 0 });
        return false;
    }

    record.count++;

    if (record.count > ABUSE_THRESHOLD) {
        record.blocked = true;
        record.blockedUntil = now + BLOCK_DURATION_MS;
        return true;
    }

    return false;
}

/**
 * Get abuse statistics for monitoring.
 */
export function getAbuseStats(): { activeKeys: number; blockedKeys: number } {
    let blockedKeys = 0;
    for (const record of abuseMap.values()) {
        if (record.blocked) blockedKeys++;
    }
    return { activeKeys: abuseMap.size, blockedKeys };
}
