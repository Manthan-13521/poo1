import { NextResponse } from "next/server";
import { generateCSRFToken } from "@/lib/csrf";

/**
 * GET /api/auth/csrf-token
 * Returns a signed CSRF token for the frontend to include in
 * mutating requests (POST/PUT/DELETE) via the x-csrf-token header.
 */
export async function GET() {
    const token = generateCSRFToken();
    return NextResponse.json({ csrfToken: token });
}
