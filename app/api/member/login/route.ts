import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { StudentMember } from "@/models/StudentMember";

export async function POST(req: Request) {
    try {
        // Rate limiting is now handled globally by middleware

        await dbConnect();
        const body = await req.json();
        const { phone, memberId } = body;

        if (!phone || !memberId) {
            return NextResponse.json({ error: "Missing required credentials" }, { status: 400 });
        }

        let member = await Member.findOne({ memberId, phone }).lean() as any;
        if (!member) {
            member = await StudentMember.findOne({ memberId, phone }).lean() as any;
        }

        if (!member) {
            return NextResponse.json({ error: "Invalid ID or Phone number combination" }, { status: 401 });
        }

        // Return a mock token for frontend state, integrating real JWT limits based on tenant config
        return NextResponse.json({ 
            success: true, 
            token: `mock_jwt_token_${member.memberId}`,
            user: { name: member.name, memberId: member.memberId, poolId: member.poolId } 
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
