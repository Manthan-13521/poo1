import { LRUCache } from 'lru-cache'

// ── Per-endpoint rate limits ─────────────────────────────────────────────
// Format: { maxRequests: perMinute }
export const RATE_LIMITS: Record<string, number> = {
    // Auth — strict (brute force protection)
    'POST:/api/member/login':       5,
    'POST:/api/auth':               10,

    // Member creation — moderate
    'POST:/api/members':            20,
    'POST:/api/entertainment-members': 20,

    // Payment — strict (financial, billing)
    'POST:/api/payments':           15,
    'POST:/api/razorpay/create-order': 10,
    'POST:/api/razorpay/verify':    10,

    // Entry/scan — moderate (high-frequency)
    'POST:/api/entry':              60,
    'POST:/api/pool/scan':          60,

    // Backups — very strict (resource-intensive)
    'POST:/api/settings/backup':          3,
    'POST:/api/settings/backup/excel':    3,
    'POST:/api/settings/backup/deleted-members': 3,
    'GET:/api/settings/backup/excel':     3,
    'GET:/api/backups/list':              10,
    'GET:/api/backups/download':          5,

    // Export — moderate
    'GET:/api/export/members':      5,
    'GET:/api/export/logs':         5,
    'GET:/api/payments/export':     5,
    'GET:/api/logs/export':         5,

    // Plans — moderate
    'POST:/api/plans':              10,
    'PUT:/api/plans':               10,
    'DELETE:/api/plans':            10,

    // Notifications — moderate
    'POST:/api/notifications':      10,
    'POST:/api/notifications/reminders': 5,

    // Pool registration (public)
    'POST:/api/pool/register':      10,
    'POST:/api/pools/subscribe':    5,

    // cron / jobs — very strict
    'GET:/api/cron/cleanup':        2,
    'POST:/api/jobs/generate-card': 10,
    'POST:/api/jobs/fix-pending':   5,

    // Super admin
    'POST:/api/super-admin/pools':  10,

    // Default catch-all (applied if no specific match)
    'DEFAULT':                      30,
}

// ── Rate limiter cache ──────────────────────────────────────────────────
const rateLimitCache = new LRUCache<string, number>({
    max: 5000,      // track up to 5000 unique IP+endpoint combos
    ttl: 60_000,    // 1 minute window
})

/**
 * Check if a request is within rate limits.
 * @returns { allowed: boolean, limit: number, remaining: number }
 */
export function checkRateLimit(ip: string, endpoint: string, method: string): {
    allowed: boolean
    limit: number
    remaining: number
} {
    // Find the most specific rate limit
    const specificKey = `${method}:${endpoint}`
    const methodWildcard = `${method}:${endpoint.replace(/\/[^/]+$/, '')}`
    const limit = RATE_LIMITS[specificKey]
        || RATE_LIMITS[methodWildcard]
        || RATE_LIMITS['DEFAULT']

    const cacheKey = `${specificKey}:${ip}`
    const current = rateLimitCache.get(cacheKey) || 0

    if (current >= limit) {
        return { allowed: false, limit, remaining: 0 }
    }

    rateLimitCache.set(cacheKey, current + 1)
    return { allowed: true, limit, remaining: limit - current - 1 }
}

/**
 * Extract client IP from request headers.
 * Works with Vercel, Cloudflare, and standard proxies.
 */
export function getClientIp(req: Request): string {
    return (
        (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
        req.headers.get('cf-connecting-ip') ||
        'unknown'
    )
}

/**
 * Standard rate limit headers for responses.
 */
export function rateLimitHeaders(limit: number, remaining: number): Record<string, string> {
    return {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(Math.max(0, remaining)),
        'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 60),
    }
}

/**
 * Security headers applied to all API responses.
 */
export const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
