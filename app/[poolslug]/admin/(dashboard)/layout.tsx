import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { dbConnect } from "@/lib/mongodb";
import { Pool } from "@/models/Pool";
import { XCircle } from "lucide-react";
import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

const getCachedPoolStatus = unstable_cache(
    async (slug: string) => {
        await dbConnect();
        const pool = await Pool.findOne({ slug }).select("subscriptionStatus poolName").lean() as any;
        return pool ? { subscriptionStatus: pool.subscriptionStatus, poolName: pool.poolName } : null;
    },
    ["pool-status"],
    { revalidate: 60 }  // recheck every 60 seconds
);

export default async function DashboardLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ poolslug: string }>;
}) {
    const pSlug = await params;
    const pool = await getCachedPoolStatus(pSlug.poolslug);

    if (pool && pool.subscriptionStatus === "paused") {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
                <div className="max-w-md text-center bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
                    <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Subscription Paused</h1>
                    <p className="text-gray-600 dark:text-gray-300">
                        Access to the `{pool.poolName}` dashboard has been temporarily suspended due to a paused subscription. Please contact the platform administrator at <b>8125629601</b> to resolve this issue.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
            {/* Sidebar for desktop */}
            <div className="hidden md:flex md:flex-shrink-0">
                <Sidebar />
            </div>

            {/* Main content area */}
            <div className="flex w-0 flex-1 flex-col overflow-hidden">
                <Topbar />

                <main className="relative flex-1 overflow-y-auto focus:outline-none bg-gray-50 dark:bg-gray-950">
                    <div className="py-6">
                        <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
                            {children}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
