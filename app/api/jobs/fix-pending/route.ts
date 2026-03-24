import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { Plan } from "@/models/Plan";
import QRCode from "qrcode";
import { uploadBuffer } from "@/lib/local-upload";
import { signQRToken } from "@/lib/qrSigner";

export const maxDuration = 60; // Allow more time for jobs

export async function GET(req: Request) {
    try {
        await dbConnect();
        
        // Ensure Plan is loaded
        const allPlans = await Plan.find().lean();
        
        let fixedCount = 0;
        let errors = [];

        // Fix missing qrCodeUrls / pending cardStatus in both collections
        for (const Model of [Member, EntertainmentMember]) {
            const stuckMembers = await Model.find({ cardStatus: "pending" });
            
            for (const member of stuckMembers) {
                try {
                    let qrCodeUrl = member.qrCodeUrl;
                    
                    if (!qrCodeUrl) {
                        const qrPayloadObject = await signQRToken(member.memberId);
                        try {
                            const qrPngBuffer = await QRCode.toBuffer(qrPayloadObject, { width: 300 });
                            qrCodeUrl = await uploadBuffer(qrPngBuffer, "swimming-pool/qrcodes", `${member.poolId}_${member.memberId}_qr`);
                        } catch (e) {
                            console.error("QR upload failed, data url fallback", e);
                            qrCodeUrl = await QRCode.toDataURL(qrPayloadObject, { width: 300 });
                        }
                        member.qrCodeUrl = qrCodeUrl;
                    }
                    
                    member.cardStatus = "ready";
                    await member.save();
                    fixedCount++;
                } catch (err: any) {
                    errors.push(`Failed to fix ${member.memberId}: ${err.message}`);
                }
            }
        }

        return NextResponse.json({ 
            success: true, 
            fixedCount, 
            errors: errors.length > 0 ? errors : undefined 
        });
    } catch (error: any) {
        return NextResponse.json({ error: "Migration failed", details: error.message }, { status: 500 });
    }
}
