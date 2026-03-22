"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { AddMemberModal } from "./AddMemberModal";
import { Plus, Search, Download, Printer, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useThermalPrint } from "@/components/printing/useThermalPrint";
import { PRIVATE_API_STALE_MS, membersListQueryKeyPrefix } from "@/lib/apiCache";

interface Plan {
    _id: string;
    name: string;
    price: number;
    hasTokenPrint?: boolean;
    quickDelete?: boolean;
    durationDays?: number;
    durationHours?: number;
    durationMinutes?: number;
}

interface EquipmentItem {
    _id: string;
    itemName: string;
    isReturned: boolean;
}

interface Member {
    _id: string;
    memberId: string;
    name: string;
    phone: string;
    age?: number;
    planId: Plan;
    planQuantity: number;
    planEndDate: string;
    expiryDate?: string;
    isExpired: boolean;
    isDeleted: boolean;
    photoUrl?: string;
    paidAmount: number;
    balanceAmount: number;
    paymentStatus: "paid" | "partial" | "pending";
    equipmentTaken: EquipmentItem[];
    createdAt: string;
}

function getRowClass(member: Member): string {
    if (member.isExpired || member.isDeleted) {
        return "bg-red-50 dark:bg-red-950/30";
    }
    const endDate = new Date(member.planEndDate || member.expiryDate || "");
    const msLeft = endDate.getTime() - Date.now();
    if (msLeft < 0) return "bg-red-50 dark:bg-red-950/30";
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    if (daysLeft <= 7) {
        return "bg-amber-50 dark:bg-amber-950/30";
    }
    return "";
}

function daysLeftLabel(member: Member): string {
    if (member.isDeleted) return "Deleted";
    if (member.isExpired) return "Expired";
    const endDate = new Date(member.planEndDate || member.expiryDate || "");
    const msLeft = endDate.getTime() - Date.now();
    if (msLeft < 0) return "Expired"; // Fix: any negative ms is expired

    // Check if it's less than 24 hours
    if (msLeft < 1000 * 60 * 60 * 24) {
        const hrs = Math.floor(msLeft / (1000 * 60 * 60));
        const mins = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
        if (hrs > 0) return `${hrs}h ${mins}m left`;
        return `${mins}m left`;
    }

    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    if (daysLeft === 0) return "Expires today";
    if (daysLeft === 1) return "1 day left";
    return `${daysLeft} days left`;
}

function statusBadge(member: Member) {
    if (member.isDeleted) return { label: "DELETED", cls: "bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-400" };
    if (member.isExpired) return { label: "EXPIRED", cls: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400" };
    const endDate = new Date(member.planEndDate || member.expiryDate || "");
    const msLeft = endDate.getTime() - Date.now();
    if (msLeft < 0) return { label: "EXPIRED", cls: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400" };

    if (msLeft < 1000 * 60 * 60 * 24) {
        return { label: "EXPIRES TODAY", cls: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400" };
    }

    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    if (daysLeft <= 7) return { label: "EXPIRING", cls: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400" };
    return { label: "ACTIVE", cls: "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-400" };
}

export default function MembersPage() {
    const queryClient = useQueryClient();
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchDebounced, setSearchDebounced] = useState("");
    const { print: printThermal } = useThermalPrint();

    const LIMIT = 10;

    const invalidateMembersList = () => {
        queryClient.invalidateQueries({ queryKey: [...membersListQueryKeyPrefix] });
    };

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setSearchDebounced(searchTerm), 400);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Reset to page 1 when search changes
    useEffect(() => { setPage(1); }, [searchDebounced]);

    const { data, isFetching, error } = useQuery({
        queryKey: [...membersListQueryKeyPrefix, page, searchDebounced, LIMIT],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(LIMIT),
                ...(searchDebounced ? { search: searchDebounced } : {}),
            });
            const res = await fetch(`/api/members?${params}`);
            if (!res.ok) throw new Error("Failed to fetch members");
            const json = await res.json();
            const rows = Array.isArray(json) ? json : (json.data ?? []);
            const total = json.total ?? rows.length;
            return { members: rows as Member[], total };
        },
        staleTime: PRIVATE_API_STALE_MS,
        placeholderData: keepPreviousData,
    });

    const members = data?.members ?? [];
    const total = data?.total ?? 0;
    const loading = isFetching;

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Soft-delete ${name}? They can be restored later.`)) return;
        try {
            const res = await fetch(`/api/members/${id}`, { method: "DELETE" });
            if (res.ok) invalidateMembersList();
            else alert((await res.json()).error || "Failed to delete member");
        } catch { alert("Server error"); }
    };

    const handleReprint = (member: Member) => {
        const plan = member.planId as Plan;
        printThermal({
            poolName: "Swimming Pool",
            memberId: member.memberId,
            name: member.name,
            age: member.age,
            phone: member.phone,
            planName: plan?.name ?? "N/A",
            planQty: member.planQuantity ?? 1,
            planPrice: plan?.price ?? 0,
            paidAmount: member.paidAmount ?? 0,
            balance: member.balanceAmount ?? 0,
            registeredAt: new Date(member.createdAt),
            validTill: new Date(member.planEndDate || member.expiryDate || ""),
        });
    };

    const totalPages = Math.max(1, Math.ceil(total / LIMIT));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="sm:flex sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Members</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {total.toLocaleString()} total members
                    </p>
                </div>
                <div className="mt-4 sm:ml-16 sm:mt-0 flex items-center space-x-3">
                    <a
                        href="/api/export/members"
                        className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
                    >
                        <Download className="-ml-0.5 mr-1.5 h-4 w-4 text-gray-400" />
                        Export
                    </a>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                    >
                        <Plus className="-ml-0.5 mr-1.5 h-4 w-4" />
                        Add Member
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                    type="text"
                    className="block w-full rounded-md border-0 py-2 pl-9 pr-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-600 sm:text-sm dark:bg-gray-800 dark:text-white dark:ring-gray-700"
                    placeholder="Search name, ID, phone…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-red-100 dark:bg-red-950/60 border border-red-200" /> Expired / Deleted</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 dark:bg-amber-950/60 border border-amber-200" /> Expiring ≤ 7 days</span>
            </div>

            {error && (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                    {(error as Error).message || "Could not load members."}
                </p>
            )}

            {/* Table */}
            <div className="flow-root">
                <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                    <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg dark:ring-white/10">
                            <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-800">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                    <tr>
                                        {["Member", "Phone", "Plan / Qty", "Equipment", "Balance", "Valid Till", "Status", ""].map((h) => (
                                            <th key={h} className="px-3 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 first:pl-6">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950">
                                    {loading ? (
                                        <tr><td colSpan={8} className="py-12 text-center">
                                            <RefreshCw className="animate-spin h-5 w-5 mx-auto text-indigo-500" />
                                        </td></tr>
                                    ) : members.length === 0 ? (
                                        <tr><td colSpan={8} className="py-12 text-center text-gray-500">No members found.</td></tr>
                                    ) : members.map((member) => {
                                        const { label, cls } = statusBadge(member);
                                        const rowCls = getRowClass(member);
                                        const plan = member.planId as Plan;
                                        const unreturned = (member.equipmentTaken ?? []).filter(e => !e.isReturned);
                                        const endDate = new Date(member.planEndDate || member.expiryDate || "");

                                        return (
                                            <tr key={member._id} className={`${rowCls} transition-colors`}>
                                                {/* Member */}
                                                <td className="whitespace-nowrap py-4 pl-6 pr-3 text-sm">
                                                    <a href={`members/${member._id}`} className="flex items-center gap-3 group">
                                                        {member.photoUrl
                                                            ? <img src={member.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-700" />
                                                            : <div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                                                                <span className="text-indigo-700 dark:text-indigo-300 font-bold text-sm">{member.name.charAt(0).toUpperCase()}</span>
                                                            </div>
                                                        }
                                                        <div>
                                                            <p className="font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{member.name}</p>
                                                            <p className="text-xs text-gray-400">
                                                                {member.memberId}{member.age ? ` · ${member.age} yrs` : ""}
                                                                {(member as any)._source === "entertainment" && (
                                                                    <span className="ml-1.5 inline-flex items-center rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 ring-1 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:ring-purple-800">🎭</span>
                                                                )}
                                                            </p>
                                                        </div>
                                                    </a>
                                                </td>
                                                {/* Phone */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">{member.phone}</td>
                                                {/* Plan / Qty */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                                    <p className="text-gray-800 dark:text-gray-200">{plan?.name ?? "N/A"}</p>
                                                    <p className="text-xs text-gray-400">Qty: {member.planQuantity ?? 1}</p>
                                                </td>
                                                {/* Equipment */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                                    {unreturned.length > 0
                                                        ? <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                                            {unreturned.length} out
                                                        </span>
                                                        : <span className="text-xs text-gray-400">—</span>
                                                    }
                                                </td>
                                                {/* Balance */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm font-medium">
                                                    {(member.balanceAmount ?? 0) > 0
                                                        ? <span className="text-red-600 dark:text-red-400">₹{member.balanceAmount.toLocaleString("en-IN")}</span>
                                                        : <span className="text-gray-400">—</span>
                                                    }
                                                </td>
                                                {/* Valid Till */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-600 dark:text-gray-400">
                                                    <p>{endDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                                                    <p className="text-xs text-gray-400">{daysLeftLabel(member)}</p>
                                                </td>
                                                {/* Status badge */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${cls}`}>{label}</span>
                                                </td>
                                                {/* Actions */}
                                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <a href={`/api/members/${member._id}/pdf`} download title="Download ID Card"
                                                            className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                                                            <Download className="h-4 w-4" />
                                                        </a>
                                                        {plan?.hasTokenPrint && (
                                                            <button onClick={() => handleReprint(member)} title="Reprint Token"
                                                                className="p-1.5 rounded-md text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors">
                                                                <Printer className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                        <button onClick={() => handleDelete(member._id, member.name)} title="Delete Member"
                                                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-800 pt-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Showing <span className="font-medium">{(page - 1) * LIMIT + 1}</span>–<span className="font-medium">{Math.min(page * LIMIT, total)}</span> of <span className="font-medium">{total}</span>
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                        className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                    </button>
                    <span className="inline-flex items-center px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        Page {page} / {totalPages}
                    </span>
                    <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages || loading}
                        className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-gray-700 bg-white ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
                    >
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                    </button>
                </div>
            </div>

            <AddMemberModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} onSuccess={invalidateMembersList} />
        </div>
    );
}
