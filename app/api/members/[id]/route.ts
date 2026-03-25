import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import { EntertainmentMember } from "@/models/EntertainmentMember";
import { invalidateCache } from "@/lib/membersCache";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/members/[id]
 * Returns a single member with populated plan.
 */
export async function GET(_req: Request, props: RouteContext) {
    try {
        await dbConnect();

        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await props.params;

        const populateFields = "name price durationDays durationHours durationMinutes hasTokenPrint quickDelete hasEntertainment hasFaceScan";
        let member: any = await Member.findById(id).select("+photoUrl").populate("planId", populateFields).lean();

        if (!member) {
            member = await EntertainmentMember.findById(id).select("+photoUrl").populate("planId", populateFields).lean();
        }

        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        // Pool isolation
        if (session.user.role !== "superadmin" && member.poolId !== session.user.poolId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        return NextResponse.json(member);
    } catch (error) {
        console.error("[GET /api/members/[id]]", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

/**
 * PATCH /api/members/[id]
 * Partial update — used for balance adjustments, plan updates, etc.
 */
export async function PATCH(req: Request, props: RouteContext) {
    try {
        await dbConnect();

        const session = await getServerSession(authOptions);
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { id } = await props.params;

        const body = await req.json();
        const { isDeleted, deletedAt, memberId, poolId, ...safeUpdates } = body;

        let member: any = await Member.findByIdAndUpdate(
            id,
            { $set: safeUpdates },
            { new: true }
        ).populate("planId", "name price hasTokenPrint");

        if (!member) {
            member = await EntertainmentMember.findByIdAndUpdate(
                id,
                { $set: safeUpdates },
                { new: true }
            ).populate("planId", "name price hasTokenPrint");
        }

        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        // Invalidate members list cache
        invalidateCache(member.poolId).catch(() => {});

        return NextResponse.json(member);
    } catch (error) {
        console.error("[PATCH /api/members/[id]]", error);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

/**
 * DELETE /api/members/[id]
 * Soft-delete — marks member as deleted.
 */
export async function DELETE(req: Request, props: RouteContext) {
    try {
        await dbConnect();

        const session = await getServerSession(authOptions);
        if (!session?.user || session.user.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await props.params;
        if (!id) return NextResponse.json({ error: "Missing member ID" }, { status: 400 });

        const deletePayload = {
            $set: {
                isDeleted:    true,
                deletedAt:    new Date(),
                deleteReason: "manual",
                isActive:     false,
                status:       "deleted",
            },
        };

        let member: any = await Member.findByIdAndUpdate(id, deletePayload, { new: true });

        if (!member) {
            member = await EntertainmentMember.findByIdAndUpdate(id, deletePayload, { new: true });
        }

        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        // Invalidate members list cache
        invalidateCache(member.poolId).catch(() => {});

        return NextResponse.json({ message: "Member soft-deleted successfully." });
    } catch (error) {
        console.error("[DELETE /api/members/[id]]", error);
        return NextResponse.json({ error: "Server error deleting member" }, { status: 500 });
    }
}
