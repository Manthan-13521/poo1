import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/mongodb";
import { User } from "@/models/User";
import { Pool } from "@/models/Pool";
import { PlatformAdmin } from "@/models/PlatformAdmin";
import bcrypt from "bcryptjs";

/**
 * POST /api/seed
 * Creates a platform super admin + demo pool + admin user for initial setup.
 *
 * ⚠️  Protected by SEED_SECRET env variable.
 * Send: Authorization: Bearer <SEED_SECRET>
 */
export async function POST(req: NextRequest) {
    const seedSecret = process.env.SEED_SECRET;

    if (!seedSecret) {
        return NextResponse.json(
            { error: "SEED_SECRET is not configured on the server.", code: "MISCONFIGURED" },
            { status: 500 }
        );
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token || token !== seedSecret) {
        return NextResponse.json(
            { error: "Unauthorized", code: "FORBIDDEN" },
            { status: 401 }
        );
    }

    await dbConnect();

    // 1. Seed Platform Super Admin
    const superAdminEmail = "superadmin@tspools.com";
    const existingSuperAdmin = await PlatformAdmin.findOne({ email: superAdminEmail });
    if (!existingSuperAdmin) {
        const superAdminPasswordHash = await bcrypt.hash("superadmin456", 10);
        await PlatformAdmin.create({
            email: superAdminEmail,
            passwordHash: superAdminPasswordHash,
            role: "superadmin"
        });
        console.log("✅ Super Admin created: superadmin@tspools.com / superadmin456");
    }

    // 2. Seed Demo Pool
    // Idempotent — don't create duplicates
    const existingPool = await Pool.findOne({ slug: "demo-pool" }).lean();
    if (existingPool) {
        return NextResponse.json({ 
            message: "Seed data already exists (Demo Pool). Super Admin checked.",
            superAdmin: superAdminEmail
        }, { status: 200 });
    }

    const poolId = "DEMO001";
    await Pool.create({
        poolId,
        poolName: "Demo Pool",
        slug: "demo-pool",
        adminEmail: "admin@demo.com",
        capacity: 100,
        status: "ACTIVE",
    });

    const passwordHash = await bcrypt.hash("admin123", 12);
    await User.create({
        name: "Demo Admin",
        email: "admin@demo.com",
        passwordHash,
        role: "admin",
        poolId,
        isActive: true,
    });

    console.warn("⚠️  Seed complete. Change these passwords immediately.");
    return NextResponse.json({ message: "Seed data created successfully." }, { status: 201 });
}

/**
 * GET /api/seed — always returns 401 (no accidental browser exposure)
 */
export async function GET() {
    return NextResponse.json(
        { error: "Unauthorized", code: "FORBIDDEN" },
        { status: 401 }
    );
}
