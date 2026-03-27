import { jobSchemas, type JobType } from "@/lib/schemas/jobSchemas";
import { sendReminders, sendWelcome } from "@/lib/services/notificationService";
import { handleMemberExpiry } from "@/lib/services/memberService";
import { handlePaymentRetry } from "@/lib/services/paymentService";
import { logger } from "@/lib/logger";

/**
 * Queue Adapter — Central dispatcher for all background jobs.
 *
 * Architecture:
 *   Route → dispatchJob() → Service Layer → Actual logic
 *
 * Currently executes jobs directly (synchronous).
 * FUTURE: Replace direct calls with `queue.add(type, data)` for BullMQ.
 *
 * Features:
 *   ✅ Zod validation inside dispatcher (never trust input)
 *   ✅ Structured logging (start, success, failure)
 *   ✅ Idempotency key preparation (for future dedup)
 *   ✅ Try-catch with error logging
 */

export async function dispatchJob(type: JobType, data: unknown): Promise<unknown> {
    // ── 1. Validate payload ──────────────────────────────────────────────
    const schema = jobSchemas[type];
    if (!schema) {
        logger.error("[QueueAdapter] Unknown job type", { type });
        throw new Error(`Unknown job type: ${type}`);
    }

    const validated = schema.parse(data);

    // ── 2. Generate idempotency key (prepared for future dedup) ──────────
    const jobKey = `${type}-${(validated as any).userId ?? (validated as any).memberId ?? "global"}-${Date.now()}`;

    // ── 3. Log dispatch ──────────────────────────────────────────────────
    logger.info("[QueueAdapter] Job dispatched", {
        jobType: type,
        jobKey,
    });

    // ── 4. Execute with error handling ───────────────────────────────────
    try {
        let result: unknown;

        switch (type) {
            case "SEND_REMINDER":
                result = await sendReminders(validated);
                break;

            case "SEND_WELCOME_WHATSAPP":
                result = await sendWelcome(validated);
                break;

            case "EXPIRE_MEMBERS":
                result = await handleMemberExpiry();
                break;

            case "PAYMENT_RETRY":
                result = await handlePaymentRetry(validated);
                break;

            default:
                throw new Error(`Unhandled job type: ${type}`);
        }

        logger.info("[QueueAdapter] Job completed", {
            jobType: type,
            jobKey,
            success: true,
        });

        return result;

    } catch (err: any) {
        logger.error("[QueueAdapter] Job failed", {
            jobType: type,
            jobKey,
            error: err?.message || String(err),
        });
        throw err;
    }
}
