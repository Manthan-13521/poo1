const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

let MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    try {
        const envLocal = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
        const match = envLocal.match(/MONGODB_URI=(.*)/);
        if (match) MONGODB_URI = match[1].trim();
    } catch (e) {
        // Fallback to default
    }
}

if (!MONGODB_URI) MONGODB_URI = "mongodb://localhost:27017/swimming-pool-system";

async function run() {
    try {
        console.log("Connecting to MongoDB:", MONGODB_URI);
        await mongoose.connect(MONGODB_URI);
        console.log("Connected successfully.");

        // Define PlatformAdmin schema locally since we're in a script
        const platformAdminSchema = new mongoose.Schema({
            email: { type: String, required: true, unique: true },
            passwordHash: { type: String, required: true },
            role: { type: String, enum: ["superadmin"], default: "superadmin" },
        }, { timestamps: true });

        const PlatformAdmin = mongoose.models.PlatformAdmin || mongoose.model("PlatformAdmin", platformAdminSchema);

        const superAdminEmail = "superadmin@tspools.com";
        const superAdminPassword = "superadmin456";

        console.log(`Checking if super admin exists: ${superAdminEmail}...`);
        const existing = await PlatformAdmin.findOne({ email: superAdminEmail });

        if (existing) {
            console.log("Super admin already exists. Updating password...");
            const hash = await bcrypt.hash(superAdminPassword, 10);
            existing.passwordHash = hash;
            await existing.save();
        } else {
            console.log("Creating new super admin...");
            const hash = await bcrypt.hash(superAdminPassword, 10);
            await PlatformAdmin.create({
                email: superAdminEmail,
                passwordHash: hash,
                role: "superadmin"
            });
        }

        console.log(`✅ SUCCESS!`);
        console.log(`Email: ${superAdminEmail}`);
        console.log(`Password: ${superAdminPassword}`);
        console.log("You can now login at /superadmin/login");

    } catch (err) {
        console.error("❌ ERROR:", err);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

run();
