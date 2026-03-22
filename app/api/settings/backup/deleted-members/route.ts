import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Member } from "@/models/Member";
import { EntertainmentMember } from "@/models/EntertainmentMember";
import { DeletedMember } from "@/models/DeletedMember";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/logger";
import ExcelJS from "exceljs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;
    let session: Session | null = null;

    if (authHeader === `Bearer ${process.env.CRON_SECRET || "cron123"}`) {
        isAuthorized = true;
    } else {
        await dbConnect();
        session = await getServerSession(authOptions);
        if (session?.user && session.user.role === "admin") {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        await dbConnect();
        const baseMatch = session?.user && session.user.role !== "superadmin" && session.user.poolId 
            ? { poolId: session.user.poolId } : {};

        // Fetch soft-deleted members
        const softDeletedMembers = await Member.find({ isDeleted: true, ...baseMatch }).lean();
        const softDeletedEntertainment = await EntertainmentMember.find({ isDeleted: true, ...baseMatch }).lean();
        
        // Fetch hard-deleted (archived) members
        const hardDeletedMembers = await DeletedMember.find({ ...baseMatch }).lean();

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "TS Pools Management System";
        workbook.created = new Date();

        const sheet = workbook.addWorksheet("Deleted Members");
        sheet.columns = [
            { header: "Member ID", key: "memberId", width: 12 },
            { header: "Name", key: "name", width: 25 },
            { header: "Phone", key: "phone", width: 15 },
            { header: "Age", key: "age", width: 8 },
            { header: "Deleted On", key: "deletedAt", width: 20 },
            { header: "Deletion Type", key: "deletionType", width: 15 },
            { header: "Source Collection", key: "collectionSource", width: 20 },
            { header: "Plan Start", key: "startDate", width: 18 },
            { header: "Expiry Date", key: "expiryDate", width: 18 },
            { header: "Entries Used", key: "entriesUsed", width: 14 }
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFF7F50" }, // Different color for distinction
        };

        const formatRow = (m: any, type: "Soft - Manual" | "Hard - Auto", source: string) => {
            const data = m.fullData || m; // fallback for soft-deleted docs
            return {
                memberId: data.memberId || m.memberId,
                name: data.name || m.name,
                phone: data.phone || m.phone,
                age: data.age || m.age || "",
                deletedAt: (m.deletedAt || data.deletedAt) ? new Date(m.deletedAt || data.deletedAt).toLocaleDateString("en-IN") : "Unknown",
                deletionType: type,
                collectionSource: source,
                startDate: data.startDate || data.planStartDate ? new Date(data.startDate || data.planStartDate).toLocaleDateString("en-IN") : "",
                expiryDate: data.expiryDate || data.planEndDate ? new Date(data.expiryDate || data.planEndDate).toLocaleDateString("en-IN") : "",
                entriesUsed: data.entriesUsed !== undefined ? data.entriesUsed : "",
            };
        };

        softDeletedMembers.forEach(m => sheet.addRow(formatRow(m, "Soft - Manual", "members")));
        softDeletedEntertainment.forEach(m => sheet.addRow(formatRow(m, "Soft - Manual", "entertainment_members")));
        hardDeletedMembers.forEach(m => sheet.addRow(formatRow(m, m.deletionType === "auto" ? "Hard - Auto" : "Soft - Manual", m.collectionSource)));

        const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "_");
        const filename = `deleted_members_${dateStr}.xlsx`;

        logger.info("Deleted Members Excel backup generated", { filename });

        const buffer = await workbook.xlsx.writeBuffer();

        // ── Upload to AWS S3 ───────────────────────────────────────────────────
        if (
            process.env.AWS_REGION &&
            process.env.AWS_ACCESS_KEY_ID &&
            process.env.AWS_SECRET_ACCESS_KEY &&
            process.env.AWS_S3_BUCKET_NAME
        ) {
            try {
                const s3Client = new S3Client({
                    region: process.env.AWS_REGION,
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                    },
                });

                // Scope backup to specific user pool
                const poolFolder = session?.user?.poolId || "superadmin";
                const s3Key = `backups/${poolFolder}/${filename}`;

                await s3Client.send(
                    new PutObjectCommand({
                        Bucket: process.env.AWS_S3_BUCKET_NAME,
                        Key: s3Key,
                        Body: Buffer.from(buffer),
                        ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    })
                );
                logger.info(`Successfully uploaded deleted-members backup to S3: ${s3Key}`);
            } catch (s3Error) {
                logger.error("Failed to upload deleted-members backup to S3", { error: String(s3Error) });
            }
        } else {
            logger.warn("AWS S3 credentials not fully configured. Skipping remote upload.");
        }

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
        });
    } catch (error) {
        logger.error("Deleted Members Excel backup failed", { error: String(error) });
        return NextResponse.json({ error: "Failed to generate Deleted Members backup" }, { status: 500 });
    }
}
