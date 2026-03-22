import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { NotificationLog } from "@/models/NotificationLog";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user)
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const baseMatch =
            session.user.role !== "superadmin" && session.user.poolId
                ? { poolId: session.user.poolId }
                : {};

        const logs = await NotificationLog.find({ ...baseMatch })
            .populate("memberId", "name memberId phone")
            .sort({ date: -1 })
            .limit(100)
            .lean();

        return NextResponse.json(logs, {
            headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
        });
    } catch (error) {
        console.error("[GET /api/notifications]", error);
        return NextResponse.json(
            { error: "Failed to fetch notification logs" },
            { status: 500 }
        );
    }
}