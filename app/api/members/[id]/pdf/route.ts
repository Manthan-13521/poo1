import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import fs from "fs";
import path from "path";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
    try {
        const { searchParams } = new URL(req.url);
        const viewInline = searchParams.get("view") === "true";
        // Disabled Auth specifically so users can download their own card directly after registration

        const { id } = await props.params;
        const memberId = id;
        if (!memberId) return NextResponse.json({ error: "Missing member ID" }, { status: 400 });

        await dbConnect();
        // Since id route parameter is the generated human string (e.g. M0002) or DB ID, fallback appropriately
        const idQuery = {
            $or: [
                { memberId: memberId },
                { _id: memberId.length === 24 ? memberId : null }
            ]
        };
        
        // Try regular member first
        let member: any = await Member.findOne(idQuery).populate("planId", "name").lean();
        
        // Fallback to entertainment member
        if (!member) {
            const { EntertainmentMember } = await import("@/models/EntertainmentMember");
            member = await EntertainmentMember.findOne(idQuery).populate("planId", "name").lean();
        }

        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

        // Create a new PDF Document
        const pdfDoc = await PDFDocument.create();

        // Horizontal ID Card size (similar to Aadhar/CR80)
        const width = 450;
        const height = 280;
        const page = pdfDoc.addPage([width, height]);

        // Draw background
        page.drawRectangle({
            x: 0,
            y: 0,
            width,
            height,
            color: rgb(0.96, 0.97, 0.98),
        });

        // Top Header
        page.drawRectangle({
            x: 0,
            y: height - 50,
            width,
            height: 50,
            color: rgb(0.18, 0.22, 0.5), // Deep Blue Header
        });

        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Header Text
        page.drawText("TELANGANA SWIMMING POOLS", { x: 20, y: height - 32, size: 16, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("OFFICIAL MEMBER ID CARD", { x: 280, y: height - 30, size: 10, font: fontBold, color: rgb(1, 1, 1) });

        // Draw decorative line
        page.drawLine({
            start: { x: 0, y: height - 50 },
            end: { x: width, y: height - 50 },
            thickness: 3,
            color: rgb(0.8, 0.6, 0.1), // Gold accent
        });

        // Helper to get image bytes from URL (local, remote, or base64)
        async function getImageBytes(imagePath: string): Promise<{ bytes: Buffer, type: 'png' | 'jpg' } | null> {
            try {
                if (imagePath.startsWith('data:image/')) {
                    const matches = imagePath.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
                    if (!matches) return null;
                    const type = matches[1] === 'png' ? 'png' : 'jpg';
                    const bytes = Buffer.from(matches[2], 'base64');
                    return { bytes, type };
                }

                if (imagePath.startsWith('http')) {
                    const response = await fetch(imagePath);
                    const arrayBuffer = await response.arrayBuffer();
                    const bytes = Buffer.from(arrayBuffer);
                    const type = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
                    return { bytes, type };
                }

                // Local path fallback
                const fullPath = path.join(process.cwd(), "public", imagePath);
                if (fs.existsSync(fullPath)) {
                    const bytes = fs.readFileSync(fullPath);
                    const type = imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
                    return { bytes, type };
                }
            } catch (err) {
                console.error("Error fetching image bytes:", err);
            }
            return null;
        }

        // Embed and Draw Photo (Left side)
        const photoSize = 100;
        if (member.photoUrl) {
            const photoData = await getImageBytes(member.photoUrl);
            if (photoData) {
                try {
                    const photoImage = photoData.type === 'png' 
                        ? await pdfDoc.embedPng(photoData.bytes)
                        : await pdfDoc.embedJpg(photoData.bytes);

                    // Draw photo box shadow/border approximation
                    page.drawRectangle({
                        x: 23, y: height - 70 - photoSize - 3,
                        width: photoSize + 6, height: photoSize + 6,
                        color: rgb(0.8, 0.8, 0.8),
                    });
                    page.drawRectangle({
                        x: 25, y: height - 70 - photoSize,
                        width: photoSize, height: photoSize,
                        color: rgb(1, 1, 1),
                    });
                    page.drawImage(photoImage, {
                        x: 25, y: height - 70 - photoSize,
                        width: photoSize, height: photoSize,
                    });
                } catch (err) {
                    console.error("Failed to embed photo image", err);
                }
            }
        }

        // ... (rest of the code for member details remains same)
        // Draw Member Details (Middle)
        let startY = height - 80;
        const textStartX = 145;

        page.drawText(member.name.toUpperCase(), { x: textStartX, y: startY, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.2) });
        startY -= 24;

        page.drawText(`ID Number:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(member.memberId, { x: textStartX + 60, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        startY -= 18;

        page.drawText(`Age:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(member.age ? member.age.toString() : "N/A", { x: textStartX + 40, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        startY -= 18;

        page.drawText(`Phone:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(member.phone, { x: textStartX + 45, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
        startY -= 18;

        // Blood group removed from ID card (Phase 3)

        if (member.aadharCard) {
            page.drawText(`Aadhar:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
            page.drawText(member.aadharCard, { x: textStartX + 45, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
            startY -= 18;
        }

        // Plan & Expiry (Bottom bar)
        page.drawRectangle({
            x: 0,
            y: 0,
            width,
            height: 40,
            color: rgb(0.9, 0.9, 0.95), // Light footer
        });

        page.drawLine({
            start: { x: 0, y: 40 },
            end: { x: width, y: 40 },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.85),
        });

        const planNameBase = (member.planId as any)?.name || "Unknown Plan";
        const isHourly = !!(member.planId as any)?.durationHours;
        const planName = (member.planQuantity && member.planQuantity > 1) 
            ? `${planNameBase} x ${member.planQuantity}` 
            : planNameBase;

        page.drawText(`Membership Plan: ${planName}`, { x: 20, y: 15, size: 11, font: fontBold, color: rgb(0.1, 0.4, 0.1) });

        const expiryStr = isHourly
            ? new Date(member.expiryDate ?? "").toLocaleString()
            : new Date(member.expiryDate ?? "").toLocaleDateString();
        page.drawText(`Valid Till: ${expiryStr}`, { x: 280, y: 15, size: 10, font: fontBold, color: rgb(0.8, 0.2, 0.2) });

        // Embed and Draw QR Code (Right bottom)
        if (member.qrCodeUrl) {
            const qrData = await getImageBytes(member.qrCodeUrl);
            if (qrData) {
                try {
                    const qrImage = await pdfDoc.embedPng(qrData.bytes);
                    const qrSize = 85;
                    page.drawImage(qrImage, {
                        x: width - qrSize - 20,
                        y: 55, // above footer
                        width: qrSize,
                        height: qrSize,
                    });
                } catch (err) {
                    console.error("Failed to embed QR code", err);
                }
            }
        }

        const pdfBytes = await pdfDoc.save();

        return new NextResponse(pdfBytes as any, {
            status: 200,
            headers: {
                "Content-Disposition": `${viewInline ? 'inline' : 'attachment'}; filename="${member.memberId}_IDCard.pdf"`,
                "Content-Type": "application/pdf",
            },
        });
    } catch (error: any) {
        console.error("[PDF CRASH ENTRY]:", error?.message, error?.stack);
        return NextResponse.json({ error: "Failed to generate ID card", details: error?.message }, { status: 500 });
    }
}
