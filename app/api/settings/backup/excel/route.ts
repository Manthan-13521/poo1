import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { Plan } from "@/models/Plan";
import { Payment } from "@/models/Payment";
import { EntryLog } from "@/models/EntryLog";
import { Settings } from "@/models/Settings";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export async function GET(req: Request) {
    // Allow cron job OR authenticated admin
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;
    let session: Session | null = null;

    if (authHeader === `Bearer ${process.env.CRON_SECRET || "cron123"}`) {
        isAuthorized = true;
    } else {
        const [, s] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        session = s;
        if (session?.user && session.user.role === "admin") {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await dbConnect();
        
        // Ensure pool separation for non-superadmins
        const baseMatch = session?.user && session.user.role !== "superadmin" && session.user.poolId 
            ? { poolId: session.user.poolId } : {};

        const [members, plans, payments, entries] = await Promise.all([
            Member.find({ status: { $ne: "deleted" }, ...baseMatch }).populate("planId", "name price").lean(),
            Plan.find({ deletedAt: null, ...baseMatch }).lean(),
            Payment.find({ ...baseMatch })
                .populate("memberId", "name memberId")
                .populate("planId", "name")
                .lean(),
            EntryLog.find({ ...baseMatch })
                .sort({ scanTime: -1 })
                .limit(5000)
                .populate("memberId", "name memberId")
                .lean(),
        ]);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "TS Pools Management System";
        workbook.created = new Date();

        // ── Members Sheet ──────────────────────────────────────────────────────
        const membersSheet = workbook.addWorksheet("Members");
        membersSheet.columns = [
            { header: "Member ID", key: "memberId", width: 12 },
            { header: "Name", key: "name", width: 25 },
            { header: "Phone", key: "phone", width: 15 },
            { header: "Age", key: "age", width: 8 },
            { header: "Plan", key: "plan", width: 20 },
            { header: "Start Date", key: "startDate", width: 18 },
            { header: "Expiry Date", key: "expiryDate", width: 18 },
            { header: "Status", key: "status", width: 12 },
            { header: "Entries Used", key: "entriesUsed", width: 14 },
            { header: "Total Entries", key: "totalEntriesAllowed", width: 14 },
            { header: "QR Code ID", key: "qrToken", width: 38 },
        ];
        membersSheet.getRow(1).font = { bold: true };
        membersSheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF4F81BD" },
        };

        members.forEach((m: any) => {
            membersSheet.addRow({
                memberId: m.memberId,
                name: m.name,
                phone: m.phone,
                age: m.age,
                plan: m.planId?.name || "N/A",
                startDate: m.startDate ? new Date(m.startDate).toLocaleDateString("en-IN") : "",
                expiryDate: m.expiryDate ? new Date(m.expiryDate).toLocaleDateString("en-IN") : "",
                status: m.status,
                entriesUsed: m.entriesUsed,
                totalEntriesAllowed: m.totalEntriesAllowed,
                qrToken: m.qrToken,
            });
        });

        // ── Plans Sheet ────────────────────────────────────────────────────────
        const plansSheet = workbook.addWorksheet("Plans");
        plansSheet.columns = [
            { header: "Plan Name", key: "name", width: 25 },
            { header: "Price (₹)", key: "price", width: 12 },
            { header: "Duration Days", key: "durationDays", width: 14 },
            { header: "Duration Hours", key: "durationHours", width: 15 },
            { header: "Duration Minutes", key: "durationMinutes", width: 17 },
            { header: "Features", key: "features", width: 40 },
            { header: "Voice Alert", key: "voiceAlert", width: 12 },
            { header: "Group Token", key: "groupToken", width: 38 },
            { header: "Max Qty", key: "maxEntriesPerQR", width: 10 },
            { header: "Remaining", key: "remainingEntries", width: 12 },
        ];
        plansSheet.getRow(1).font = { bold: true };

        plans.forEach((p: any) => {
            plansSheet.addRow({
                name: p.name,
                price: p.price,
                durationDays: p.durationDays || "",
                durationHours: p.durationHours || "",
                durationMinutes: p.durationMinutes || "",
                features: (p.features || []).join(", "),
                voiceAlert: p.voiceAlert ? "Yes" : "No",
                groupToken: p.groupToken || "",
                maxEntriesPerQR: p.maxEntriesPerQR || 1,
                remainingEntries: p.remainingEntries || 0,
            });
        });

        // ── ID Cards Sheet ─────────────────────────────────────────────────────
        const cardsSheet = workbook.addWorksheet("ID Cards");
        cardsSheet.columns = [
            { header: "Member ID", key: "memberId", width: 12 },
            { header: "Name", key: "name", width: 25 },
            { header: "Plan", key: "plan", width: 20 },
            { header: "Photo URL", key: "photoUrl", width: 40 },
            { header: "QR URL", key: "qrCodeUrl", width: 40 },
            { header: "ID Card (PDF Link)", key: "pdfLink", width: 50 },
        ];
        cardsSheet.getRow(1).font = { bold: true };

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        members.forEach((m: any) => {
            cardsSheet.addRow({
                memberId: m.memberId,
                name: m.name,
                plan: (m.planId as any)?.name || "N/A",
                photoUrl: m.photoUrl ? `${baseUrl}${m.photoUrl}` : "N/A",
                qrCodeUrl: m.qrCodeUrl ? `${baseUrl}${m.qrCodeUrl}` : "N/A",
                pdfLink: `${baseUrl}/api/members/${m.memberId}/pdf`,
            });
        });

        // ── Payments Sheet ─────────────────────────────────────────────────────
        const paymentsSheet = workbook.addWorksheet("Payments");
        paymentsSheet.columns = [
            { header: "Member ID", key: "memberId", width: 12 },
            { header: "Member Name", key: "memberName", width: 25 },
            { header: "Plan", key: "plan", width: 20 },
            { header: "Amount (₹)", key: "amount", width: 12 },
            { header: "Method", key: "method", width: 18 },
            { header: "Transaction ID", key: "transactionId", width: 30 },
            { header: "Status", key: "status", width: 12 },
            { header: "Date", key: "date", width: 20 },
        ];
        paymentsSheet.getRow(1).font = { bold: true };

        payments.forEach((p: any) => {
            paymentsSheet.addRow({
                memberId: (p.memberId as any)?.memberId || "",
                memberName: (p.memberId as any)?.name || "",
                plan: (p.planId as any)?.name || "",
                amount: p.amount,
                method: p.paymentMethod,
                transactionId: p.transactionId || p.razorpayOrderId || "",
                status: p.status,
                date: p.date ? new Date(p.date).toLocaleString("en-IN") : "",
            });
        });

        // ── Entry Logs Sheet ───────────────────────────────────────────────────
        const entrySheet = workbook.addWorksheet("Entry Logs");
        entrySheet.columns = [
            { header: "Member ID", key: "memberId", width: 12 },
            { header: "Member Name", key: "memberName", width: 25 },
            { header: "Scan Time", key: "scanTime", width: 22 },
            { header: "Status", key: "status", width: 10 },
            { header: "Reason", key: "reason", width: 30 },
            { header: "Raw Payload", key: "rawPayload", width: 40 },
        ];
        entrySheet.getRow(1).font = { bold: true };

        entries.forEach((e: any) => {
            entrySheet.addRow({
                memberId: (e.memberId as any)?.memberId || "",
                memberName: (e.memberId as any)?.name || "",
                scanTime: e.scanTime ? new Date(e.scanTime).toLocaleString("en-IN") : "",
                status: e.status,
                reason: e.reason || "",
                rawPayload: e.rawPayload || "",
            });
        });

        // ── Save to disk ───────────────────────────────────────────────────────
        const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        const filename = `backup_${dateStr}.xlsx`;

        // removed file-system writes (Vercel is read-only)

        // Update lastBackupAt in settings (database write is okay)
        await Settings.updateOne({}, { $set: { lastBackupAt: new Date() } });
        
        const buffer = await workbook.xlsx.writeBuffer();

        return new NextResponse(buffer as ArrayBuffer, {
            status: 200,
            headers: {
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
        });
    } catch (error) {
        logger.error("Excel backup failed", { error: String(error) });
        return NextResponse.json({ error: "Failed to generate Excel backup" }, { status: 500 });
    }
}
