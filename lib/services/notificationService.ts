import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Plan } from "@/models/Plan";
import { NotificationLog } from "@/models/NotificationLog";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { logger } from "@/lib/logger";

// ── Types ────────────────────────────────────────────────────────────────

export interface SendReminderPayload {
    poolId?: string; // optional: filter by pool
}

export interface SendWelcomePayload {
    memberName: string;
    memberId: string;
    phone: string;
    poolId: string;
}

// ── Send Expiry Reminders ────────────────────────────────────────────────
// Extracted from /api/notifications/reminders POST handler.
// Sends WhatsApp reminders to members expiring in 7 days, 2 days, or yesterday.

export async function sendReminders(payload: SendReminderPayload): Promise<{
    totalFound: number;
    sentSuccessfully: number;
}> {
    await dbConnect();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const inTwoDays = new Date(today);
    inTwoDays.setDate(inTwoDays.getDate() + 2);

    const inThreeDays = new Date(today);
    inThreeDays.setDate(inThreeDays.getDate() + 3);

    const inSevenDays = new Date(today);
    inSevenDays.setDate(inSevenDays.getDate() + 7);

    const inEightDays = new Date(today);
    inEightDays.setDate(inEightDays.getDate() + 8);

    const poolFilter: Record<string, unknown> = {};
    if (payload.poolId) {
        poolFilter.poolId = payload.poolId;
    }

    const membersExpiring = await Member.find({
        ...poolFilter,
        $or: [
            { status: "active", expiryDate: { $gte: inSevenDays, $lt: inEightDays } },
            { status: "active", expiryDate: { $gte: inTwoDays, $lt: inThreeDays } },
            { expiryDate: { $gte: yesterday, $lt: today } },
        ],
    })
        .populate("planId", "whatsAppAlert durationDays durationHours")
        .select("name phone memberId expiryDate planId")
        .lean();

    let sentCount = 0;
    const logs: InstanceType<typeof NotificationLog>[] = [];

    for (const member of membersExpiring) {
        const plan = member.planId as any;
        if (!plan?.whatsAppAlert) continue;

        const isHourly = !!plan?.durationHours;
        const durationDays = plan?.durationDays || 0;

        if (!isHourly && durationDays >= 7) {
            const expiryDate = member.expiryDate ?? new Date();
            const isExpiringSoon7 = expiryDate >= inSevenDays && expiryDate < inEightDays;
            const isExpiringSoon2 = expiryDate >= inTwoDays && expiryDate < inThreeDays;
            const expiryDateStr = new Date(expiryDate).toLocaleDateString();

            let message = "";
            if (isExpiringSoon7) {
                message = `Hello ${member.name}, your swimming pool membership (ID: ${member.memberId}) is expiring in 7 days on ${expiryDateStr}. Please renew it to continue enjoying the pool!\n- TS Pools Mgmt`;
            } else if (isExpiringSoon2) {
                message = `Hello ${member.name}, your swimming pool membership (ID: ${member.memberId}) is expiring in 2 days on ${expiryDateStr}. Please renew it to continue enjoying the pool!\n- TS Pools Mgmt`;
            } else {
                message = `Hello ${member.name}, your swimming pool membership (ID: ${member.memberId}) has expired. Please renew it to continue enjoying the pool!\n- TS Pools Mgmt`;
            }

            const success = await sendWhatsAppMessage(member.phone, message);

            const log = new NotificationLog({
                memberId: member._id,
                type: "whatsapp",
                message,
                status: success ? "sent" : "failed",
            });

            logs.push(log);
            if (success) sentCount++;
        }
    }

    if (logs.length > 0) {
        await NotificationLog.insertMany(logs);
    }

    logger.info("[NotificationService] Reminders processed", {
        totalFound: membersExpiring.length,
        sentSuccessfully: sentCount,
    });

    return { totalFound: membersExpiring.length, sentSuccessfully: sentCount };
}

// ── Send Welcome WhatsApp ────────────────────────────────────────────────
// Extracted from /api/razorpay/verify POST handler.

export async function sendWelcome(payload: SendWelcomePayload): Promise<boolean> {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const idCardUrl = `${baseUrl}/api/members/${payload.memberId}/pdf`;
    const welcomeMessage = `Hello ${payload.memberName}! Your registration is successful. ID Card: ${idCardUrl}\n\n- TS Pools Mgmt`;

    const success = await sendWhatsAppMessage(payload.phone, welcomeMessage);

    logger.info("[NotificationService] Welcome message", {
        memberId: payload.memberId,
        success,
    });

    return success;
}
