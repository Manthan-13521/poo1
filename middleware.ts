import { withAuth } from "next-auth/middleware";
import { NextResponse, NextRequest } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";

// ── In-middleware rate limiter (edge-compatible, no imports from Node libs) ──
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMITS: Record<string, number> = {
    'POST:/api/member/login': 5,
    'POST:/api/members': 20,
    'POST:/api/entertainment-members': 20,
    'POST:/api/payments': 15,
    'POST:/api/razorpay/create-order': 10,
    'POST:/api/razorpay/verify': 10,
    'POST:/api/entry': 60,
    'POST:/api/pool/scan': 60,
    'POST:/api/settings/backup': 3,
    'GET:/api/settings/backup/excel': 3,
    'GET:/api/backups/list': 10,
    'GET:/api/backups/download': 5,
    'GET:/api/export/members': 5,
    'GET:/api/payments/export': 5,
    'POST:/api/plans': 10,
    'POST:/api/notifications': 10,
    'POST:/api/pool/register': 10,
    'POST:/api/pools/subscribe': 5,
    'GET:/api/cron/cleanup': 2,
    'POST:/api/jobs/generate-card': 10,
    'POST:/api/seed': 2,
};
const DEFAULT_LIMIT = 60;
const WINDOW_MS = 60_000;

function rateLimit(ip: string, method: string, path: string) {
    // Normalize: strip dynamic segments for matching
    const normalized = path.replace(/\/[a-f0-9]{24}/g, '').replace(/\/[^/]+\/admin/, '');
    const key = `${method}:${normalized}`;
    const limit = RATE_LIMITS[key] || DEFAULT_LIMIT;
    const cacheKey = `${key}:${ip}`;
    const now = Date.now();

    const record = rateMap.get(cacheKey);
    if (record) {
        if (now > record.resetAt) {
            rateMap.set(cacheKey, { count: 1, resetAt: now + WINDOW_MS });
            return { allowed: true, limit, remaining: limit - 1 };
        }
        if (record.count >= limit) {
            return { allowed: false, limit, remaining: 0 };
        }
        record.count++;
        return { allowed: true, limit, remaining: limit - record.count };
    }

    rateMap.set(cacheKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit, remaining: limit - 1 };
}

// Cleanup stale entries periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateMap.entries()) {
        if (now > val.resetAt) rateMap.delete(key);
    }
}, 5 * 60_000);

// ── Security headers applied to all responses ──
const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ── CORS allowed origins ──
const ALLOWED_ORIGINS = new Set([
    'http://localhost:3000',
    'https://localhost:3000',
    process.env.NEXTAUTH_URL || '',
    process.env.NEXT_PUBLIC_BASE_URL || '',
].filter(Boolean));

function applyCORS(req: NextRequest, res: NextResponse) {
    const origin = req.headers.get('origin') || '';
    if (ALLOWED_ORIGINS.has(origin) || !origin) {
        res.headers.set('Access-Control-Allow-Origin', origin || '*');
    }
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Access-Control-Max-Age', '86400');
}

function applySecurityHeaders(res: NextResponse) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(key, value);
    }
}

export default withAuth(
    function middleware(req: NextRequestWithAuth) {
        const token = req.nextauth.token;
        const path = req.nextUrl.pathname;
        const method = req.method;

        // ── Handle CORS preflight ──
        if (method === 'OPTIONS') {
            const res = new NextResponse(null, { status: 204 });
            applyCORS(req, res);
            applySecurityHeaders(res);
            return res;
        }

        // ── Rate limiting for ALL /api/ routes ──
        if (path.startsWith('/api/')) {
            const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
                || req.headers.get('x-real-ip')
                || 'unknown';

            const result = rateLimit(ip, method, path);

            if (!result.allowed) {
                const res = NextResponse.json(
                    { error: 'Too many requests. Please slow down.', retryAfterSeconds: 60 },
                    { status: 429 }
                );
                res.headers.set('Retry-After', '60');
                res.headers.set('X-RateLimit-Limit', String(result.limit));
                res.headers.set('X-RateLimit-Remaining', '0');
                applySecurityHeaders(res);
                return res;
            }

            // Continue with rate limit headers on successful requests
            const res = NextResponse.next();
            res.headers.set('X-RateLimit-Limit', String(result.limit));
            res.headers.set('X-RateLimit-Remaining', String(result.remaining));
            applySecurityHeaders(res);
            applyCORS(req, res);
            return res;
        }

        // ── Super Admin page protection ──
        if (path.startsWith('/superadmin')) {
            if (path === '/superadmin/login') {
                const res = NextResponse.next();
                applySecurityHeaders(res);
                return res;
            }
            if (!token || token.role !== 'superadmin') {
                return NextResponse.redirect(new URL('/superadmin/login', req.url));
            }
            const res = NextResponse.next();
            applySecurityHeaders(res);
            return res;
        }

        // ── Pool Admin page protection ──
        const poolAdminRegex = /^\/([^/]+)\/admin(\/.*)?$/;
        const match = path.match(poolAdminRegex);

        if (match) {
            const poolSlug = match[1];
            const adminSubRoute = match[2] || '';

            if (adminSubRoute.includes('/login')) {
                const res = NextResponse.next();
                applySecurityHeaders(res);
                return res;
            }

            if (!token || (token.role !== 'admin' && token.role !== 'operator')) {
                return NextResponse.redirect(new URL(`/${poolSlug}/admin/login`, req.url));
            }

            if (token.poolSlug !== poolSlug) {
                return NextResponse.redirect(new URL(`/${poolSlug}/admin/login`, req.url));
            }

            const res = NextResponse.next();
            applySecurityHeaders(res);
            return res;
        }

        const res = NextResponse.next();
        applySecurityHeaders(res);
        return res;
    },
    {
        callbacks: {
            authorized: () => true,
        },
    }
);

export const config = {
    matcher: [
        '/superadmin/:path*',
        '/:poolslug/admin/:path*',
        '/api/:path*',
    ],
};
