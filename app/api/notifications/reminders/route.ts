import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dispatchJob } from "@/lib/queueAdapter";

export async function POST(req: Request) {
    const authHeader = req.headers.get("authorization");

    // Allow Cron Jobs with Secret OR Authenticated Admins
    let isAuthorized = false;
    let session: Session | null = null;
    let poolId: string | undefined;

    if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
        isAuthorized = true;
    } else {
        await dbConnect();
        session = await getServerSession(authOptions);
        if (session?.user && session.user.role === "admin") {
            isAuthorized = true;
            poolId = session.user.poolId;
        }
    }

    if (!isAuthorized) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await dispatchJob("SEND_REMINDER", { poolId });

        return NextResponse.json({
            message: "Reminders processed",
            ...result as any,
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 });
    }
}
