import crypto from "crypto";

/**
 * CSRF Token utilities.
 * Tokens are generated server-side and must be sent back by the frontend
 * in the `x-csrf-token` header on all mutating requests (POST/PUT/DELETE).
 */

const CSRF_SECRET = process.env.NEXTAUTH_SECRET || process.env.CSRF_SECRET || "fallback-csrf-secret";

/**
 * Generate a CSRF token.
 * Format: timestamp.signature
 * The signature is HMAC-SHA256 of the timestamp using the server secret.
 */
export function generateCSRFToken(): string {
    const timestamp = Date.now().toString();
    const signature = crypto
        .createHmac("sha256", CSRF_SECRET)
        .update(timestamp)
        .digest("hex");
    return `${timestamp}.${signature}`;
}

/**
 * Verify a CSRF token.
 * Checks that:
 * 1. Token has valid format
 * 2. Signature matches
 * 3. Token is not older than 24 hours
 */
export function verifyCSRFToken(token: string): boolean {
    if (!token || typeof token !== "string") return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [timestamp, signature] = parts;
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return false;

    // Token expires after 24 hours
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - ts > MAX_AGE_MS) return false;

    // Verify signature using timing-safe comparison
    const expectedSignature = crypto
        .createHmac("sha256", CSRF_SECRET)
        .update(timestamp)
        .digest("hex");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, "hex"),
            Buffer.from(expectedSignature, "hex")
        );
    } catch {
        return false;
    }
}
