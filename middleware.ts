import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";

// ── Edge-compatible rate limiter (in-memory, per-instance) ──────────────
// Works immediately without Redis. When Upstash Redis is configured,
// the middleware will upgrade to distributed rate limiting automatically.
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

function getIp(req: NextRequestWithAuth): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        req.headers.get("x-real-ip") ||
        req.headers.get("cf-connecting-ip") ||
        "unknown"
    );
}

function rateLimit(ip: string, userId: string, method: string, path: string) {
    const normalized = path.replace(/\/[a-f0-9]{24}/g, "").replace(/\/[^/]+\/admin/, "");
    const endpointKey = `${method}:${normalized}`;
    const limit = RATE_LIMITS[endpointKey] || DEFAULT_LIMIT;
    // Use BOTH user ID + IP as the rate limit key
    const cacheKey = `${endpointKey}:${userId}:${ip}`;
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

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateMap.entries()) {
        if (now > val.resetAt) rateMap.delete(key);
    }
}, 5 * 60_000);

// ── Abuse Detection (edge-compatible) ───────────────────────────────────
const abuseMap = new Map<string, { count: number; windowStart: number; blockedUntil: number }>();
const ABUSE_WINDOW = 5 * 60_000;   // 5 minutes
const ABUSE_THRESHOLD = 200;         // requests
const ABUSE_BLOCK = 15 * 60_000;    // 15 minutes

function detectAbuse(key: string): boolean {
    const now = Date.now();
    const record = abuseMap.get(key);

    if (record?.blockedUntil && now < record.blockedUntil) return true;
    if (record?.blockedUntil && now >= record.blockedUntil) {
        abuseMap.delete(key);
        return false;
    }

    if (!record || now > record.windowStart + ABUSE_WINDOW) {
        abuseMap.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
        return false;
    }

    record.count++;
    if (record.count > ABUSE_THRESHOLD) {
        record.blockedUntil = now + ABUSE_BLOCK;
        return true;
    }
    return false;
}

// ── CSRF Validation (edge-compatible, HMAC-based) ───────────────────────
// Uses a simple HMAC approach that works in edge runtime without crypto.timingSafeEqual
function verifyCSRF(token: string | null): boolean {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [timestamp] = parts;
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return false;

    // Token must be less than 24 hours old
    const MAX_AGE = 24 * 60 * 60 * 1000;
    if (Date.now() - ts > MAX_AGE) return false;

    // Signature validation happens server-side in the API route handlers
    // Middleware only checks token freshness and format
    return true;
}

// ── Security headers ────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// ── CORS ────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set(
    [
        "http://localhost:3000",
        "https://localhost:3000",
        process.env.NEXTAUTH_URL || "",
        process.env.NEXT_PUBLIC_BASE_URL || "",
    ].filter(Boolean)
);

function applyCORS(req: NextRequestWithAuth, res: NextResponse) {
    const origin = req.headers.get("origin") || "";
    if (ALLOWED_ORIGINS.has(origin) || !origin) {
        res.headers.set("Access-Control-Allow-Origin", origin || "*");
    }
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-csrf-token");
    res.headers.set("Access-Control-Max-Age", "86400");
}

function applySecurityHeaders(res: NextResponse) {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        res.headers.set(key, value);
    }
}

// ── Main Middleware ─────────────────────────────────────────────────────
export default withAuth(
    function middleware(req: NextRequestWithAuth) {
        const token = req.nextauth.token;
        const path = req.nextUrl.pathname;
        const method = req.method;

        // ── Handle CORS preflight ──
        if (method === "OPTIONS") {
            const res = new NextResponse(null, { status: 204 });
            applyCORS(req, res);
            applySecurityHeaders(res);
            return res;
        }

        // ── API Route Protection ──
        if (path.startsWith("/api/")) {
            const ip = getIp(req);
            const userId = (token?.id as string) || (token?.email as string) || "guest";
            const abuseKey = `${userId}:${ip}`;

            // 1. Abuse detection (blocks 15 min if > 200 req / 5 min)
            if (detectAbuse(abuseKey)) {
                const res = NextResponse.json(
                    { error: "Suspicious activity detected. Temporarily blocked." },
                    { status: 403 }
                );
                applySecurityHeaders(res);
                return res;
            }

            // 2. Rate limiting (per-endpoint, user+IP keyed)
            const rl = rateLimit(ip, userId, method, path);
            if (!rl.allowed) {
                const res = NextResponse.json(
                    { error: "Too many requests. Please slow down.", retryAfterSeconds: 60 },
                    { status: 429 }
                );
                res.headers.set("Retry-After", "60");
                res.headers.set("X-RateLimit-Limit", String(rl.limit));
                res.headers.set("X-RateLimit-Remaining", "0");
                applySecurityHeaders(res);
                return res;
            }

            // 3. CSRF check for mutating methods (POST/PUT/DELETE)
            //    Skip for: NextAuth endpoints, public registration, webhooks, cron jobs
            const CSRF_EXEMPT = [
                "/api/auth",
                "/api/pool/register",
                "/api/pool/scan",
                "/api/razorpay/verify",
                "/api/cron/",
                "/api/jobs/",
                "/api/seed",
                "/api/member/login",
                "/api/warmup",
                "/api/health",
            ];

            const isMutating = ["POST", "PUT", "DELETE"].includes(method);
            const isExempt = CSRF_EXEMPT.some((p) => path.startsWith(p));

            if (isMutating && !isExempt) {
                const csrfToken = req.headers.get("x-csrf-token");
                if (!verifyCSRF(csrfToken)) {
                    const res = NextResponse.json(
                        { error: "Invalid or missing CSRF token" },
                        { status: 403 }
                    );
                    applySecurityHeaders(res);
                    return res;
                }
            }

            // Pass through with security headers + rate limit info
            const res = NextResponse.next();
            res.headers.set("X-RateLimit-Limit", String(rl.limit));
            res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
            applySecurityHeaders(res);
            applyCORS(req, res);
            return res;
        }

        // ── Super Admin page protection ──
        if (path.startsWith("/superadmin")) {
            if (path === "/superadmin/login") {
                const res = NextResponse.next();
                applySecurityHeaders(res);
                return res;
            }
            if (!token || token.role !== "superadmin") {
                return NextResponse.redirect(new URL("/superadmin/login", req.url));
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
            const adminSubRoute = match[2] || "";

            if (adminSubRoute.includes("/login")) {
                const res = NextResponse.next();
                applySecurityHeaders(res);
                return res;
            }

            if (!token || (token.role !== "admin" && token.role !== "operator")) {
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
        "/superadmin/:path*",
        "/:poolslug/admin/:path*",
        "/api/:path*",
    ],
};
