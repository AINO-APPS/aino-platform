/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { default as API } from "../../api/client";
import { useAuth } from "../../AuthContext";
import { useToast } from "./Toast";
import { SESSION_REVOKED_EVENT } from "../../hooks/useWebSocket";

export default function AxiosInterceptor({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate();
    const { logout } = useAuth() as any;
    const toast = useToast() as any;
    // Use refs to avoid stale closures in the interceptor
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const logoutRef = useRef(logout);
    logoutRef.current = logout;
    const isLoggingOutRef = useRef(false);

    useEffect(() => {
        const interceptor = API.interceptors.response.use(
            (response) => response,
            (error) => {
                const status = error.response?.status;
                const url = error.config?.url || "";
                // /auth/mfa/* 401s are sign-in steps (expired ticket), not an ended session.
                if (status === 401 && !url.includes("/auth/logout") && !url.includes("/auth/mfa/") && !url.includes("/auth/login") && !url.includes("/auth/handoff")) {
                    // Debounce: only the first 401 triggers logout
                    if (!isLoggingOutRef.current) {
                        isLoggingOutRef.current = true;
                        logoutRef.current().finally(() => {
                            isLoggingOutRef.current = false;
                        });
                        navigate("/login", { replace: true });
                    }
                } else if (status === 429) {
                    toastRef.current.warning("Too many requests. Please slow down.");
                } else if (status >= 500) {
                    toastRef.current.error("Server error. Please try again later.");
                } else if (!error.response) {
                    // Network error (no response at all)
                    toastRef.current.error("Network error. Check your connection.");
                }
                return Promise.reject(error);
            }
        );

        return () => {
            API.interceptors.response.eject(interceptor);
        };
    }, [navigate]);

    // A sign-in on another browser / desktop app ended this session: sign out now
    // instead of waiting for the next API call to come back 401.
    useEffect(() => {
        const onRevoked = () => {
            if (isLoggingOutRef.current) return;
            isLoggingOutRef.current = true;
            toastRef.current.warning("You were signed out because your account signed in on another device.");
            logoutRef.current().finally(() => {
                isLoggingOutRef.current = false;
            });
            navigate("/login", { replace: true });
        };
        window.addEventListener(SESSION_REVOKED_EVENT, onRevoked);
        return () => window.removeEventListener(SESSION_REVOKED_EVENT, onRevoked);
    }, [navigate]);

    return children;
}