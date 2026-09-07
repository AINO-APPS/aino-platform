import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import NProgress from "nprogress";
import "nprogress/nprogress.css";

export type AnyData = Record<string, unknown> | unknown;
export type Params = Record<string, unknown>;

NProgress.configure({ showSpinner: false });

// Disable NProgress loading bar in Electron desktop app
const isElectron = !!import.meta.env.VITE_ELECTRON;
// Desktop (Electron) builds set VITE_API_URL to the Railway server; web builds use relative /api
export const baseURL =
    import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:5000/api");
export const serverURL = import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/api$/, "")
    : "";

// REBRAND (WorkPulse -> AINO): this value is a CSRF contract shared with
// server/index.ts, the mobile client and the desktop protocol proxy. The server
// accepts both values, but clients keep the legacy value for rollback safety.
const CSRF_HEADER_VALUE = "WorkPulse";

const API = axios.create({
    baseURL,
    withCredentials: true,
    headers: { "X-Requested-With": CSRF_HEADER_VALUE },
});

// Get today's date in local timezone as YYYY-MM-DD
export function getLocalToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Get a date N days ago in local timezone as YYYY-MM-DD
export function getLocalDate(daysAgo = 0): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Attach timezone offset to every request (auth is sent via HttpOnly cookie).
API.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (!isElectron) NProgress.start();
    config.headers["x-timezone-offset"] = new Date().getTimezoneOffset();
    return config;
});

// AxiosInterceptor handles 401/token expiration separately.
API.interceptors.response.use(
    (response) => {
        if (!isElectron) NProgress.done();
        return response;
    },
    (error) => {
        if (!isElectron) NProgress.done();
        return Promise.reject(error);
    },
);

export default API;
