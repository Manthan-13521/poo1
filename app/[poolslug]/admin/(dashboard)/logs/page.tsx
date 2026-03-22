"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Download, Search, UserPlus, ScanFace } from "lucide-react";


interface SystemLog {
    id: string;
    date: string;
    type: string;
    description: string;
    member: string;
    memberId: string;
    photoUrl?: string;
}

export default function LogsPage() {
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [regPage, setRegPage] = useState(1);
    const [entryPage, setEntryPage] = useState(1);
    const ITEMS_PER_PAGE = 9;

    useEffect(() => {
        setLoading(true);
        fetch(`/api/logs?type=all&t=${Date.now()}`, { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
                setLogs(Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
                setLoading(false);
            })
            .catch((err) => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const handleExport = () => {
        window.location.href = `/api/logs/export?type=all`;
    };

    const filteredLogs = logs.filter(
        (log) =>
            log.member.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.memberId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Separating the tables
    const registrationLogs = filteredLogs.filter(log => log.type === "Registration");
    const entryLogs = filteredLogs.filter(log => log.type === "Entry Scan");

    const totalRegPages = Math.max(1, Math.ceil(registrationLogs.length / ITEMS_PER_PAGE));
    const paginatedRegistrations = registrationLogs.slice((regPage - 1) * ITEMS_PER_PAGE, regPage * ITEMS_PER_PAGE);

    const totalEntryPages = Math.max(1, Math.ceil(entryLogs.length / ITEMS_PER_PAGE));
    const paginatedEntries = entryLogs.slice((entryPage - 1) * ITEMS_PER_PAGE, entryPage * ITEMS_PER_PAGE);

    // Reset pages when search changes
    useEffect(() => { 
        setRegPage(1); 
        setEntryPage(1);
    }, [searchTerm]);

    // Grouping entry logs by Local Date string
    const groupedEntries = useMemo(() => {
        const groups: Record<string, SystemLog[]> = {};
        // We group the paginated entries so we strictly show the page items
        paginatedEntries.forEach(log => {
            const dateStr = new Date(log.date).toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(log);
        });
        return groups;
    }, [paginatedEntries]);

    return (
        <div className="space-y-8">
            <div className="sm:flex sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">System Logs</h1>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        View Registration and Entry history.
                    </p>
                </div>
                <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
                    <button
                        onClick={handleExport}
                        className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
                    >
                        <Download className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400" />
                        Export All Logs
                    </button>
                </div>
            </div>

            <div className="max-w-md relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                    type="text"
                    className="block w-full rounded-md border-0 py-2 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6 dark:bg-gray-800 dark:text-white dark:ring-gray-700"
                    placeholder="Search members or descriptions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Registrations Table */}
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-xl dark:ring-white/10 bg-white dark:bg-gray-900 flex flex-col max-h-[700px]">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
                        <UserPlus className="h-5 w-5 text-indigo-500" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Registrations</h2>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-800">
                            <thead className="bg-white dark:bg-gray-900 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">Time</th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Member</th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-950">
                                {loading ? (
                                    <tr><td colSpan={3} className="py-10 text-center text-gray-500">Loading...</td></tr>
                                ) : paginatedRegistrations.length === 0 ? (
                                    <tr><td colSpan={3} className="py-10 text-center text-gray-500">No registrations found.</td></tr>
                                ) : (
                                    paginatedRegistrations.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                            <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm text-gray-500 dark:text-gray-400 sm:pl-6">
                                                {new Date(log.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-900 dark:text-white flex items-center gap-3">
                                                {log.photoUrl ? (
                                                    <img src={log.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-700" />
                                                ) : (
                                                    <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                                                        <span className="text-indigo-700 dark:text-indigo-300 font-bold text-xs">{log.member.charAt(0).toUpperCase()}</span>
                                                    </div>
                                                )}
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{log.member}</span>
                                                    <span className="text-xs text-gray-500">{log.memberId}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                                                <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset mb-1 mr-2 bg-purple-50 text-purple-700 ring-purple-600/20">
                                                    {log.type}
                                                </span>
                                                {log.description}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination Footer */}
                    {totalRegPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                Page <span className="font-medium">{regPage}</span> of <span className="font-medium">{totalRegPages}</span>
                            </span>
                            <div className="flex space-x-2">
                                <button
                                    onClick={() => setRegPage(p => Math.max(1, p - 1))}
                                    disabled={regPage === 1}
                                    className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-900 dark:text-gray-300 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => setRegPage(p => Math.min(totalRegPages, p + 1))}
                                    disabled={regPage === totalRegPages}
                                    className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-900 dark:text-gray-300 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Entry Scans Table */}
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-xl dark:ring-white/10 bg-white dark:bg-gray-900 flex flex-col max-h-[700px]">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2">
                        <ScanFace className="h-5 w-5 text-blue-500" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Entry Scans</h2>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-800">
                            <thead className="bg-white dark:bg-gray-900 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">Time</th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Member</th>
                                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">Status</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-950">
                                {loading ? (
                                    <tr><td colSpan={3} className="py-10 text-center text-gray-500">Loading...</td></tr>
                                ) : Object.keys(groupedEntries).length === 0 ? (
                                    <tr><td colSpan={3} className="py-10 text-center text-gray-500">No entry scans found.</td></tr>
                                ) : (
                                    Object.entries(groupedEntries).map(([dateLabel, logsForDate]) => (
                                        <React.Fragment key={dateLabel}>
                                            {/* Date Separator Row */}
                                            <tr className="bg-gray-100 dark:bg-gray-800/80 border-y border-gray-200 dark:border-gray-700">
                                                <td colSpan={3} className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                                    {dateLabel}
                                                </td>
                                            </tr>
                                            {logsForDate.map((log) => (
                                                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800/50 last:border-none">
                                                    <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm text-gray-500 dark:text-gray-400 sm:pl-6 shadow-sm">
                                                        {new Date(log.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-900 dark:text-white flex items-center gap-3">
                                                        {log.photoUrl ? (
                                                            <img src={log.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover ring-1 ring-gray-200 dark:ring-gray-700" />
                                                        ) : (
                                                            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                                                                <span className="text-blue-700 dark:text-blue-300 font-bold text-xs">{log.member.charAt(0).toUpperCase()}</span>
                                                            </div>
                                                        )}
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{log.member}</span>
                                                            <span className="text-xs text-gray-500">{log.memberId}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                                                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${log.description.toLowerCase().includes('denied') ? "bg-red-50 text-red-700 ring-red-600/20" : "bg-green-50 text-green-700 ring-green-600/20"}`}>
                                                            {log.description}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination Footer */}
                    {totalEntryPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                Page <span className="font-medium">{entryPage}</span> of <span className="font-medium">{totalEntryPages}</span>
                            </span>
                            <div className="flex space-x-2">
                                <button
                                    onClick={() => setEntryPage(p => Math.max(1, p - 1))}
                                    disabled={entryPage === 1}
                                    className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-900 dark:text-gray-300 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => setEntryPage(p => Math.min(totalEntryPages, p + 1))}
                                    disabled={entryPage === totalEntryPages}
                                    className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 px-3 py-1 text-sm font-semibold text-gray-900 dark:text-gray-300 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
