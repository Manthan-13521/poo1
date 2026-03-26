"use client";

import { useState, useEffect } from "react";
import { Users, RotateCcw, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";


interface ExpiredMember {
    _id: string;
    memberId: string;
    name: string;
    phone: string;
    age?: number;
    expiryDate: string;
    qrToken: string;
    planId?: { name: string; price: number; durationDays?: number; durationHours?: number };
}

export default function ExpiredMembersPage() {
    const [members, setMembers] = useState<ExpiredMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchExpired = async (p = 1) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/members/expired?page=${p}&limit=11`);
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setMembers(data.members || []);
            setTotalPages(data.pagination?.totalPages || 1);
            setTotal(data.pagination?.total || 0);
            setPage(p);
        } catch (e: any) {
            setError(e.message || "Failed to load expired members");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchExpired(1); }, []);

    const formatExpiry = (date: string) => new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric"
    });

    const daysSinceExpiry = (date: string) => {
        const diff = Date.now() - new Date(date).getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <AlertCircle className="w-6 h-6 text-red-500" />
                        Expired Memberships
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {total} member{total !== 1 ? "s" : ""} with expired memberships
                    </p>
                </div>
                <button
                    onClick={() => fetchExpired(page)}
                    className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
                >
                    <RotateCcw className="w-4 h-4" /> Refresh
                </button>
            </div>

            {loading ? (
                <div className="animate-pulse space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 bg-gray-200 dark:bg-gray-800 rounded-xl" />
                    ))}
                </div>
            ) : error ? (
                <div className="text-center py-16 text-red-500">{error}</div>
            ) : members.length === 0 ? (
                <div className="text-center py-16 flex flex-col items-center gap-3 text-gray-500">
                    <Users className="w-12 h-12 text-gray-300" />
                    <p className="font-medium">No expired members found.</p>
                    <p className="text-sm">All memberships are active!</p>
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 shadow">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    {["Member ID", "Name", "Phone", "Plan", "Expiry Date", "Days Expired", "QR Token (ID)"].map(h => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {members.map((m) => (
                                    <tr key={m._id} className="hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors">
                                        <td className="px-4 py-3 text-sm font-mono font-medium text-indigo-600 dark:text-indigo-400">{m.memberId}</td>
                                        <td className="px-4 py-3">
                                            <div className="text-sm font-medium text-gray-900 dark:text-white">{m.name}</div>
                                            {m.age && <div className="text-xs text-gray-500">Age: {m.age}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{m.phone}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                                            {m.planId?.name || <span className="text-gray-400 italic">No plan</span>}
                                            {m.planId?.price && <div className="text-xs text-gray-400">₹{m.planId.price}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-red-600 dark:text-red-400 font-medium">
                                            {formatExpiry(m.expiryDate)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                                {daysSinceExpiry(m.expiryDate)}d ago
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs font-mono text-gray-400 dark:text-gray-600 max-w-[140px] truncate" title={m.qrToken}>
                                            {m.qrToken?.slice(0, 16)}…
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => fetchExpired(page - 1)}
                                    disabled={page <= 1}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Prev
                                </button>
                                <button
                                    onClick={() => fetchExpired(page + 1)}
                                    disabled={page >= totalPages}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    Next <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
