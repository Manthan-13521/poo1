import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { Settings, getSettings } from "@/models/Settings";
import { Pool } from "@/models/Pool";
import { PoolSession } from "@/models/PoolSession";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
    try {
        const [, settings, session] = await Promise.all([
            dbConnect(),
            getSettings(),
            getServerSession(authOptions),
        ]);

        const url = new URL(req.url);
        const poolslug = url.searchParams.get("poolslug");

        let activeCapacity = settings.poolCapacity;
        let pool = null;

        if (poolslug) {
            pool = await Pool.findOne({ slug: poolslug }).select("capacity").lean();
        } else if (session?.user?.poolId) {
            pool = await Pool.findOne({ poolId: session.user.poolId }).select("capacity").lean();
        }

        if (pool) {
            activeCapacity = (pool as any).capacity || activeCapacity;
        }

        return NextResponse.json({
            poolCapacity: activeCapacity,
            currentOccupancy: settings.currentOccupancy,
            occupancyDurationMinutes: settings.occupancyDurationMinutes || 60,
            available: Math.max(0, activeCapacity - settings.currentOccupancy),
            lastBackupAt: settings.lastBackupAt,
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to fetch capacity" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const [, session] = await Promise.all([
            dbConnect(),
            getServerSession(authOptions),
        ]);
        if (!session?.user || !["admin", "superadmin"].includes(session.user.role)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await req.json();
        const { poolCapacity, currentOccupancy, occupancyDurationMinutes } = body;
        const settings = await getSettings();

        const url = new URL(req.url);
        const poolslug = url.searchParams.get("poolslug");

        let activeCapacity = settings.poolCapacity;
        if (typeof poolCapacity === "number" && poolCapacity > 0) {
            let pool = null;
            if (poolslug) {
                pool = await Pool.findOne({ slug: poolslug });
            } else if (session.user.poolId) {
                pool = await Pool.findOne({ poolId: session.user.poolId });
            }

            if (pool) {
                pool.capacity = poolCapacity;
                await pool.save();
                activeCapacity = pool.capacity;
            } else {
                settings.poolCapacity = poolCapacity;
                activeCapacity = poolCapacity;
            }
        }

        if (typeof currentOccupancy === "number" && currentOccupancy >= 0) {
            settings.currentOccupancy = currentOccupancy;

            // Resolve poolId for this pool
            let poolId = null;
            if (poolslug) {
                const poolDoc = await Pool.findOne({ slug: poolslug }).select("poolId").lean();
                if (poolDoc) poolId = (poolDoc as any).poolId;
            } else if (session.user.poolId) {
                poolId = session.user.poolId;
            }

            if (poolId) {
                // Step 1: Expire ALL active sessions (scans + walk-ins)
                await PoolSession.updateMany(
                    { poolId, status: "active" },
                    { $set: { status: "expired", expiryTime: new Date() } }
                );

                // Step 2: If setting to a number > 0, create exactly N walk-in sessions
                if (currentOccupancy > 0) {
                    const durationMins = settings.occupancyDurationMinutes || 60;
                    const expiryTime = new Date(Date.now() + durationMins * 60 * 1000);

                    const walkInSessions = [];
                    for (let i = 0; i < currentOccupancy; i++) {
                        walkInSessions.push({
                            poolId,
                            memberId: null,
                            numPersons: 1,
                            status: "active",
                            expiryTime,
                            notes: "Manual walk-in entry",
                        });
                    }
                    await PoolSession.insertMany(walkInSessions);
                }
            }
        }
        if (typeof occupancyDurationMinutes === "number" && occupancyDurationMinutes > 0) {
            settings.occupancyDurationMinutes = occupancyDurationMinutes;
        }
        await settings.save();

        return NextResponse.json({
            poolCapacity: activeCapacity,
            currentOccupancy: settings.currentOccupancy,
            occupancyDurationMinutes: settings.occupancyDurationMinutes,
            available: Math.max(0, activeCapacity - settings.currentOccupancy),
        });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Failed to update capacity" }, { status: 500 });
    }
}
