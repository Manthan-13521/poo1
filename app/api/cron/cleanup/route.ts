import { NextResponse } from "next/server";
import { dispatchJob } from "@/lib/queueAdapter";

/**
 * GET /api/cron/cleanup
 * Protected by CRON_SECRET.
 *
 * Member lifecycle deletion state machine (runs daily at 2 AM via vercel.json):
 *   1. Mark expired members (planEndDate passed)
 *   2a. Soft-delete Quick Delete plan members 3 days after expiry
 *   2b. Soft-delete Standard plan members 10 days after expiry
 *   3. Purge all entry logs older than 5 days, and attendance logs 3 days after soft-delete
 *   4. Hard-delete members 6 days after soft-delete
 *   NOTE: Payments are NEVER deleted (compliance requirement).
 *
 * Now dispatched via queueAdapter for future BullMQ readiness.
 */
export async function GET(req: Request) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    const querySecret = new URL(req.url).searchParams.get("secret");
    const providedSecret = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : querySecret;

    if (!cronSecret || providedSecret !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized", code: "FORBIDDEN" }, { status: 401 });
    }

    try {
        const results = await dispatchJob("EXPIRE_MEMBERS", {});

        console.log("[Cron Cleanup]", new Date().toISOString(), results);
        return NextResponse.json({ success: true, timestamp: new Date(), ...results as any });
    } catch (error: any) {
        console.error("[Cron Cleanup] Failed:", error);
        return NextResponse.json(
            { error: error?.message || "Cleanup failed" },
            { status: 500 }
        );
    }
}
