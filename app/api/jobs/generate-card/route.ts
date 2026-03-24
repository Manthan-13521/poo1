import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { Plan } from "@/models/Plan";
import QRCode from "qrcode";
import { uploadBuffer } from "@/lib/local-upload";
import { signQRToken } from "@/lib/qrSigner";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import path from "path";
import fs from "fs";

export const maxDuration = 60; // Allow more time for jobs

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { memberObjId, memberId, poolId, isEntertainment } = await req.json();
        
        if (!memberObjId || !memberId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        await dbConnect();
        
        const Model: any = isEntertainment ? EntertainmentMember : Member;
        const member = await Model.findById(memberObjId).populate("planId");
        
        if (!member) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // 1. Generate QR Code
        const qrPayloadObject = await signQRToken(memberId);
        let qrCodeUrl = "";
        try {
            const qrPngBuffer = await QRCode.toBuffer(qrPayloadObject, { width: 300 });
            qrCodeUrl = await uploadBuffer(qrPngBuffer, "swimming-pool/qrcodes", `${poolId}_${memberId}_qr`);
        } catch (e) {
            console.error("QR Code local upload failed, falling back to Data URL", e);
            qrCodeUrl = await QRCode.toDataURL(qrPayloadObject, { width: 300 });
        }

        // Update Member with QR code so PDF generation can embed it
        member.qrCodeUrl = qrCodeUrl;
        await member.save();

        // 2. Generate PDF ID Card
        let pdfUrl = "";
        try {
            const pdfBytes = await generatePDFBytes(member);
            const pdfBuffer = Buffer.from(pdfBytes);
            pdfUrl = await uploadBuffer(pdfBuffer, "swimming-pool/pdfs", `${poolId}_${memberId}_idcard`);
        } catch (pdfErr) {
            console.error("Background PDF generation failed", pdfErr);
            // Optionally, we don't block it if PDF fails. Provide fallback logic in UI.
        }

        // 3. Mark as Ready
        member.cardStatus = "ready";
        if (pdfUrl) {
            member.pdfUrl = pdfUrl;
        }
        await member.save();

        return NextResponse.json({ success: true, memberId, cardStatus: "ready" });
    } catch (error) {
        console.error("[generate-card job]", error);
        return NextResponse.json({ error: "Job failed" }, { status: 500 });
    }
}

// Reuse logic from [id]/pdf/route.ts
async function generatePDFBytes(member: any) {
    const pdfDoc = await PDFDocument.create();
    const width = 450;
    const height = 280;
    const page = pdfDoc.addPage([width, height]);

    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.96, 0.97, 0.98) });
    page.drawRectangle({ x: 0, y: height - 50, width, height: 50, color: rgb(0.18, 0.22, 0.5) });

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText("TELANGANA SWIMMING POOLS", { x: 20, y: height - 32, size: 16, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText("OFFICIAL MEMBER ID CARD", { x: 280, y: height - 30, size: 10, font: fontBold, color: rgb(1, 1, 1) });
    page.drawLine({ start: { x: 0, y: height - 50 }, end: { x: width, y: height - 50 }, thickness: 3, color: rgb(0.8, 0.6, 0.1) });

    async function getImageBytes(imagePath: string): Promise<{ bytes: Buffer, type: 'png' | 'jpg' } | null> {
        if (!imagePath) return null;
        try {
            if (imagePath.startsWith('data:image/')) {
                const matches = imagePath.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
                if (!matches) return null;
                return { type: matches[1] === 'png' ? 'png' : 'jpg', bytes: Buffer.from(matches[2], 'base64') };
            }
            if (imagePath.startsWith('http')) {
                const response = await fetch(imagePath, { headers: { 'User-Agent': 'Mozilla/5.0' }});
                if (!response.ok) return null;
                const contentType = response.headers.get('content-type');
                const arrayBuffer = await response.arrayBuffer();
                return { type: contentType?.includes('png') ? 'png' : 'jpg', bytes: Buffer.from(arrayBuffer) };
            }
            const fullPath = path.join(process.cwd(), "public", imagePath);
            if (fs.existsSync(fullPath)) {
                return { type: imagePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg', bytes: fs.readFileSync(fullPath) };
            }
        } catch (e) { console.error("getImageBytes failed", e); }
        return null;
    }

    // Photo
    const photoSize = 100;
    if (member.photoUrl) {
        const photoData = await getImageBytes(member.photoUrl);
        if (photoData) {
            try {
                const photoImage = photoData.type === 'png' ? await pdfDoc.embedPng(photoData.bytes) : await pdfDoc.embedJpg(photoData.bytes);
                page.drawRectangle({ x: 23, y: height - 70 - photoSize - 3, width: photoSize + 6, height: photoSize + 6, color: rgb(0.8, 0.8, 0.8) });
                page.drawRectangle({ x: 25, y: height - 70 - photoSize, width: photoSize, height: photoSize, color: rgb(1, 1, 1) });
                page.drawImage(photoImage, { x: 25, y: height - 70 - photoSize, width: photoSize, height: photoSize });
            } catch (err) {}
        }
    }

    // Details
    let startY = height - 80;
    const textStartX = 145;

    page.drawText(member.name ? member.name.toUpperCase() : "UNKNOWN", { x: textStartX, y: startY, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.2) });
    startY -= 24;
    page.drawText(`ID Number:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(member.memberId || "N/A", { x: textStartX + 60, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    startY -= 18;
    page.drawText(`Age:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(member.age ? member.age.toString() : "N/A", { x: textStartX + 40, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    startY -= 18;
    page.drawText(`Phone:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(member.phone ? member.phone.toString() : "N/A", { x: textStartX + 45, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    startY -= 18;

    if (member.aadharCard) {
        page.drawText(`Aadhar:`, { x: textStartX, y: startY, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });
        page.drawText(member.aadharCard, { x: textStartX + 45, y: startY, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    }

    // Footer
    page.drawRectangle({ x: 0, y: 0, width, height: 40, color: rgb(0.9, 0.9, 0.95) });
    page.drawLine({ start: { x: 0, y: 40 }, end: { x: width, y: 40 }, thickness: 1, color: rgb(0.8, 0.8, 0.85) });

    const planNameBase = member.planId?.name || "Unknown Plan";
    const isHourly = !!member.planId?.durationHours;
    const planName = (member.planQuantity && member.planQuantity > 1) ? `${planNameBase} x ${member.planQuantity}` : planNameBase;

    page.drawText(`Membership Plan: ${planName}`, { x: 20, y: 15, size: 11, font: fontBold, color: rgb(0.1, 0.4, 0.1) });

    const effectiveExpiryDate = member.expiryDate || member.planEndDate || "";
    const expiryDateObj = new Date(effectiveExpiryDate);
    
    let expiryStr = "Invalid Date";
    if (!isNaN(expiryDateObj.getTime())) {
        expiryStr = isHourly ? expiryDateObj.toLocaleString() : expiryDateObj.toLocaleDateString();
    }
    
    page.drawText(`Valid Till: ${expiryStr}`, { x: 280, y: 15, size: 10, font: fontBold, color: rgb(0.8, 0.2, 0.2) });

    // QR
    if (member.qrCodeUrl) {
        const qrData = await getImageBytes(member.qrCodeUrl);
        if (qrData) {
            try {
                const qrImage = qrData.type === 'png' ? await pdfDoc.embedPng(qrData.bytes) : await pdfDoc.embedJpg(qrData.bytes);
                const qrSize = 85;
                page.drawImage(qrImage, { x: width - qrSize - 20, y: 55, width: qrSize, height: qrSize });
            } catch (err) {}
        }
    }

    return await pdfDoc.save();
}
