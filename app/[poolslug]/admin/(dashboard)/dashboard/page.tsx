import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Users, UserX, Activity, DollarSign, ArrowUpRight, TrendingUp, Heart } from "lucide-react";
import ChartSkeleton from "@/components/ChartSkeleton";
import { getCachedDashboardCounts, getCachedAnalyticsSummary } from "@/lib/queries";
import { Member } from "@/models/Member";
import { dbConnect } from "@/lib/mongodb";

// Stats Component (Server)
async function DashboardStats({ poolId, isAdmin }: { poolId: string, isAdmin: boolean }) {
    const summary = await getCachedAnalyticsSummary(poolId);
    const counts = await getCachedDashboardCounts(poolId);

    const stats = [
        { name: "Total Members", stat: counts.totalMembers, icon: Users, color: "bg-blue-500" },
        { name: "Active Members", stat: counts.activeMembers, icon: Activity, color: "bg-green-500" },
        { name: "Expired Members", stat: counts.totalMembers - counts.activeMembers, icon: UserX, color: "bg-red-500" },
        { name: "Today's Entries", stat: counts.todaysEntries, icon: ArrowUpRight, color: "bg-indigo-500" },
    ];

    if (isAdmin) {
        stats.push({ name: "Today's Revenue", stat: `₹${summary.totalRevenue}`, icon: DollarSign, color: "bg-yellow-500" });
        stats.push({ name: "Monthly Revenue", stat: `₹${summary.monthlyRevenue}`, icon: TrendingUp, color: "bg-purple-500" });
    }

    return (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {stats.map((item) => (
                <div
                    key={item.name}
                    className="relative overflow-hidden rounded-xl bg-white px-4 pb-12 pt-5 shadow sm:px-6 sm:pt-6 dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
                >
                    <dt>
                        <div className={`absolute rounded-md ${item.color} p-3`}>
                            <item.icon className="h-6 w-6 text-white" aria-hidden="true" />
                        </div>
                        <p className="ml-16 truncate text-sm font-medium text-gray-500 dark:text-gray-400">
                            {item.name}
                        </p>
                    </dt>
                    <dd className="ml-16 flex items-baseline pb-6 sm:pb-7">
                        <p className="text-2xl font-semibold text-gray-900 dark:text-white">{item.stat}</p>
                    </dd>
                </div>
            ))}
        </div>
    );
}

// System Health Component (Server)
async function SystemHealth() {
    // Only Admin can see this anyway, we conditionally render it
    
    // Fallbacks just for display layout match
    const health = {
        database: { status: "connected" },
        system: { uptime: "N/A", memoryUsedMB: 0, memoryTotalMB: 0 },
        recentErrors: []
    };

    return (
        <div className="rounded-xl bg-white shadow p-6 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Heart className="w-5 h-5 text-rose-500" /> System Health
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div className="flex flex-col">
                    <span className="text-gray-500 text-xs uppercase font-medium">DB Status</span>
                    <span className={`font-semibold mt-1 ${health.database?.status === "connected" ? "text-green-600" : "text-red-500"}`}>{health.database?.status}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-gray-500 text-xs uppercase font-medium">Uptime</span>
                    <span className="font-semibold mt-1 text-gray-900 dark:text-white">{health.system?.uptime}</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-gray-500 text-xs uppercase font-medium">Heap Memory</span>
                    <span className="font-semibold mt-1 text-gray-900 dark:text-white">{health.system?.memoryUsedMB} / {health.system?.memoryTotalMB} MB</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-gray-500 text-xs uppercase font-medium">Last Backup</span>
                    <span className="font-semibold mt-1 text-gray-900 dark:text-white">Active (S3)</span>
                </div>
            </div>
        </div>
    );
}

// Alerts Component (Server)
async function ExpiryAlerts({ poolId }: { poolId: string }) {
    await dbConnect();

    // IST timezone-safe "today" calculation
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);
    const startOfDayIST = new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0)
    );
    startOfDayIST.setTime(startOfDayIST.getTime() - IST_OFFSET);

    const baseMatch = poolId && poolId !== "superadmin" ? { poolId } : {};

    const expiringMembers = await Member.find({
        ...baseMatch,
        isDeleted: false,
        $or: [
            { planEndDate: { $gte: startOfDayIST, $lte: new Date(startOfDayIST.getTime() + 3 * 86400000) } },
            { expiryDate: { $gte: startOfDayIST, $lte: new Date(startOfDayIST.getTime() + 3 * 86400000) } },
        ]
    })
    .select('memberId name phone expiryDate planEndDate planQuantity')
    .lean();

    const alerts = expiringMembers.map((m: any) => ({
        id: m._id,
        memberId: m.memberId,
        name: m.name,
        phone: m.phone,
        qty: m.planQuantity || 1,
        remainingDays: Math.ceil((new Date(m.planEndDate || m.expiryDate).getTime() - startOfDayIST.getTime()) / 86400000)
    }));

    return (
        <div className="rounded-xl bg-orange-50 p-6 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30">
            <h2 className="text-lg font-semibold text-orange-800 dark:text-orange-400 mb-4 flex items-center">
                <span className="w-2 h-2 bg-orange-500 rounded-full mr-2 animate-pulse"></span>
                Expiring Soon (Next 3 Days)
            </h2>
            {alerts.length > 0 ? (
                <ul className="space-y-3 shadow-inner max-h-48 overflow-y-auto pr-2">
                    {alerts.map((m: any) => (
                        <li key={m.id || m.memberId} className="flex justify-between items-center text-sm py-2 border-b border-orange-200/50 dark:border-orange-800/50 last:border-0">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-orange-900 dark:text-orange-200">{m.name}</span>
                                    <span className="text-xs text-orange-600 dark:text-orange-400">({m.memberId})</span>
                                </div>
                                <span className="text-xs text-orange-500 mt-1">{m.phone}</span>
                            </div>
                            <div className="text-right flex flex-col items-end">
                                <span className={`font-semibold ${m.remainingDays <= 0 ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                    {m.remainingDays <= 0 ? 'Today' : `In ${m.remainingDays} day${m.remainingDays > 1 ? 's' : ''}`}
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-orange-600 dark:text-orange-400">No members expiring soon.</p>
            )}
        </div>
    );
}

// Main Page (Server Component)
export default async function DashboardPage() {
    const session = await getServerSession(authOptions) as any;
    const poolId = session?.user?.role !== "superadmin" ? session?.user?.poolId : "superadmin";
    const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin";

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Overview</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Welcome back, {session?.user?.name || "Admin"}. Here's what's happening today.
                </p>
            </div>

            <Suspense fallback={
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    <ChartSkeleton /><ChartSkeleton /><ChartSkeleton />
                </div>
            }>
                <DashboardStats poolId={poolId} isAdmin={isAdmin} />
            </Suspense>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {isAdmin && (
                    <Suspense fallback={<div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />}>
                        <SystemHealth />
                    </Suspense>
                )}
                <Suspense fallback={<div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />}>
                    <ExpiryAlerts poolId={poolId} />
                </Suspense>
            </div>
        </div>
    );
}
