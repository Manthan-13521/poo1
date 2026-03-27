"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * Hook to manage CSRF tokens for secure API requests.
 *
 * Usage:
 *   const { fetchWithCSRF } = useCSRF();
 *   await fetchWithCSRF("/api/payments", { method: "POST", body: JSON.stringify(data) });
 */
export function useCSRF() {
    const tokenRef = useRef<string | null>(null);
    const fetchingRef = useRef(false);

    // Fetch a CSRF token on mount
    useEffect(() => {
        async function fetchToken() {
            if (fetchingRef.current) return;
            fetchingRef.current = true;
            try {
                const res = await fetch("/api/auth/csrf-token");
                const data = await res.json();
                tokenRef.current = data.csrfToken;
            } catch {
                console.warn("[CSRF] Failed to fetch token");
            } finally {
                fetchingRef.current = false;
            }
        }
        fetchToken();
    }, []);

    /**
     * Wrapper around fetch() that automatically includes the CSRF token.
     */
    const fetchWithCSRF = useCallback(
        async (url: string, options: RequestInit = {}): Promise<Response> => {
            // Refresh token if expired or missing
            if (!tokenRef.current) {
                try {
                    const res = await fetch("/api/auth/csrf-token");
                    const data = await res.json();
                    tokenRef.current = data.csrfToken;
                } catch {
                    // Continue without token — server will reject if required
                }
            }

            const headers = new Headers(options.headers || {});
            if (tokenRef.current) {
                headers.set("x-csrf-token", tokenRef.current);
            }
            if (!headers.has("Content-Type") && options.body) {
                headers.set("Content-Type", "application/json");
            }

            return fetch(url, { ...options, headers });
        },
        []
    );

    return { fetchWithCSRF, csrfToken: tokenRef.current };
}
