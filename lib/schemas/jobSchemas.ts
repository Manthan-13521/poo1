import { z } from "zod";

/**
 * Zod schemas for each background job type.
 * Used by queueAdapter.ts to validate payloads BEFORE dispatch.
 */

export const SendReminderSchema = z.object({
    poolId: z.string().optional(),
});

export const SendWelcomeWhatsAppSchema = z.object({
    memberName: z.string().min(1),
    memberId: z.string().min(1),
    phone: z.string().min(1),
    poolId: z.string().min(1),
});

export const ExpireMembersSchema = z.object({}).passthrough();

export const PaymentRetrySchema = z.object({
    memberId: z.string().min(1),
    paymentId: z.string().min(1),
    amount: z.number().positive(),
    planId: z.string().min(1),
});

/**
 * Map of job type → Zod schema for validation inside the dispatcher.
 */
export const jobSchemas: Record<string, z.ZodType<any>> = {
    SEND_REMINDER: SendReminderSchema,
    SEND_WELCOME_WHATSAPP: SendWelcomeWhatsAppSchema,
    EXPIRE_MEMBERS: ExpireMembersSchema,
    PAYMENT_RETRY: PaymentRetrySchema,
};

/**
 * All valid job types.
 */
export type JobType = "SEND_REMINDER" | "SEND_WELCOME_WHATSAPP" | "EXPIRE_MEMBERS" | "PAYMENT_RETRY";
