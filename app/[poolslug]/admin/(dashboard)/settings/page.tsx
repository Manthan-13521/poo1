"use client";

import { useState, useEffect } from "react";
import { Save, HardDrive, Moon, Sun, Monitor, Download, Users, Activity, Server } from "lucide-react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";


export default function SettingsPage() {
    const { data: session } = useSession();
    const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin";
    const params = useParams();
    const poolslug = params.poolslug as string;

    const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
    const [poolCapacity, setPoolCapacity] = useState<number>(50);
    const [currentOccupancy, setCurrentOccupancy] = useState<number>(0);
    const [occupancyDurationMinutes, setOccupancyDurationMinutes] = useState<number>(60);
    const [capacityLoading, setCapacityLoading] = useState(false);
    const [capacitySaved, setCapacitySaved] = useState(false);
    const [excelLoading, setExcelLoading] = useState(false);
    const [deletedExcelLoading, setDeletedExcelLoading] = useState(false);

    const applyTheme = (newTheme: "light" | "dark" | "system") => {
        const root = window.document.documentElement;
        root.classList.remove("light", "dark");
        if (newTheme === "system") {
            root.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        } else {
            root.classList.add(newTheme);
        }
    };

    useEffect(() => {
        const savedTheme = localStorage.getItem("theme") as "light" | "dark" | "system" | null;
        if (savedTheme) { setTheme(savedTheme); applyTheme(savedTheme); }
    }, []);

    useEffect(() => {
        if (!isAdmin || !poolslug) return;
        fetch(`/api/settings/capacity?poolslug=${poolslug}`)
            .then(r => r.json())
            .then(d => { setPoolCapacity(d.poolCapacity ?? 50); setCurrentOccupancy(d.currentOccupancy ?? 0); setOccupancyDurationMinutes(d.occupancyDurationMinutes ?? 60); })
            .catch(() => {});
    }, [isAdmin, poolslug]);

    const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
        setTheme(newTheme); localStorage.setItem("theme", newTheme); applyTheme(newTheme);
    };

    const handleCapacitySave = async () => {
        setCapacityLoading(true);
        try {
            const res = await fetch(`/api/settings/capacity?poolslug=${poolslug}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ poolCapacity, currentOccupancy, occupancyDurationMinutes }),
            });
            if (res.ok) { setCapacitySaved(true); setTimeout(() => setCapacitySaved(false), 3000); }
        } finally { setCapacityLoading(false); }
    };

    const handleJsonBackup = () => { window.location.href = "/api/settings/backup"; };

    const handleExcelBackup = async () => {
        setExcelLoading(true);
        try {
            const res = await fetch("/api/settings/backup/excel");
            if (!res.ok) { alert("Failed to generate Excel backup"); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ts_pools_backup_${new Date().toISOString().split("T")[0]}.xlsx`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch { alert("Error generating backup"); }
        finally { setExcelLoading(false); }
    };

    const handleDeletedExcelBackup = async () => {
        setDeletedExcelLoading(true);
        try {
            const res = await fetch("/api/settings/backup/deleted-members");
            if (!res.ok) { alert("Failed to generate Deleted Members backup"); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ts_pools_deleted_members_${new Date().toISOString().split("T")[0]}.xlsx`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch { alert("Error generating backup"); }
        finally { setDeletedExcelLoading(false); }
    };

    return (
        <div className="space-y-10 max-w-4xl">
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Manage system preferences, pool capacity, and data backups.
                </p>
            </div>

            {/* Appearance */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-3">
                <div>
                    <h2 className="text-base font-semibold leading-7 text-gray-900 dark:text-white">Appearance</h2>
                    <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">Customize how the application looks.</p>
                </div>
                <div className="md:col-span-2">
                    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 p-6">
                        <fieldset>
                            <legend className="text-sm font-semibold leading-6 text-gray-900 dark:text-white">Theme Preference</legend>
                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {(["light", "dark", "system"] as const).map((t) => (
                                    <label key={t} className={`relative flex cursor-pointer rounded-lg border bg-white dark:bg-gray-800 p-4 shadow-sm ${theme === t ? "border-indigo-600 ring-1 ring-indigo-600" : "border-gray-300 dark:border-gray-700"}`}>
                                        <input type="radio" className="sr-only" name="theme" value={t} checked={theme === t} onChange={() => handleThemeChange(t)} />
                                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                                            {t === "light" ? <Sun className="w-5 h-5 text-yellow-500" /> : t === "dark" ? <Moon className="w-5 h-5 text-indigo-400" /> : <Monitor className="w-5 h-5 text-gray-500" />}
                                            {t.charAt(0).toUpperCase() + t.slice(1)}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </div>
                </div>
            </div>

            <hr className="border-gray-200 dark:border-gray-800" />

            {isAdmin && (
                <>
                    {/* Pool Capacity */}
                    <div className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-3">
                        <div>
                            <h2 className="text-base font-semibold leading-7 text-gray-900 dark:text-white flex items-center gap-2">
                                <Users className="w-5 h-5 text-indigo-500" /> Pool Capacity
                            </h2>
                            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
                                Set maximum swimmer capacity. Entry will be blocked when the pool is full.
                            </p>
                        </div>
                        <div className="md:col-span-2">
                            <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum Capacity</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={1000}
                                            value={poolCapacity}
                                            onChange={(e) => setPoolCapacity(parseInt(e.target.value) || 50)}
                                            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Occupancy (manual reset)</label>
                                        <input
                                            type="number"
                                            min={0}
                                            value={currentOccupancy}
                                            onChange={(e) => setCurrentOccupancy(parseInt(e.target.value) || 0)}
                                            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div className="col-span-2 sm:col-span-1 border-t sm:border-t-0 pt-4 sm:pt-0 border-gray-200 dark:border-gray-800">
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Occupancy Duration (minutes)</label>
                                        <p className="text-xs text-gray-500 mb-2">Auto-checkout time for daily/monthly plans</p>
                                        <input
                                            type="number"
                                            min={1}
                                            value={occupancyDurationMinutes}
                                            onChange={(e) => setOccupancyDurationMinutes(parseInt(e.target.value) || 60)}
                                            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleCapacitySave}
                                        disabled={capacityLoading}
                                        className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 transition-colors"
                                    >
                                        <Save className="w-4 h-4" />
                                        {capacityLoading ? "Saving..." : "Save Capacity"}
                                    </button>
                                    {capacitySaved && <span className="text-sm text-green-600 dark:text-green-400 font-medium">✓ Saved!</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    <hr className="border-gray-200 dark:border-gray-800" />

                    {/* Data Backup */}
                    <div className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-3">
                        <div>
                            <h2 className="text-base font-semibold leading-7 text-gray-900 dark:text-white flex items-center gap-2">
                                <HardDrive className="w-5 h-5 text-indigo-500" /> Data Management
                            </h2>
                            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
                                Export full database backups. Excel backups are securely pushed to AWS S3 storage automatically.
                            </p>
                        </div>
                        <div className="md:col-span-2">
                            <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 p-6 space-y-4">
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Database Backup</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Download a complete backup of all members, plans, payments, entry logs. Keep this file secure.
                                </p>
                                <div className="flex flex-wrap gap-3">
                                    <button
                                        onClick={handleExcelBackup}
                                        disabled={excelLoading}
                                        className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:opacity-60 transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                        {excelLoading ? "Generating..." : "Download Excel Backup (.xlsx)"}
                                    </button>
                                    <button
                                        onClick={handleDeletedExcelBackup}
                                        disabled={deletedExcelLoading}
                                        className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-60 transition-colors"
                                    >
                                        <Download className="w-4 h-4" />
                                        {deletedExcelLoading ? "Generating..." : "Download Deleted Members (.xlsx)"}
                                    </button>
                                    <button
                                        onClick={handleJsonBackup}
                                        className="inline-flex items-center gap-2 rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-600 transition-colors"
                                    >
                                        <HardDrive className="w-4 h-4" />
                                        Download JSON Backup
                                    </button>
                                </div>
                                <p className="text-xs text-gray-400 dark:text-gray-600 pt-1">
                                    Excel files are also securely synced to your dedicated <strong>AWS S3 Bucket</strong> automatically.
                                </p>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
