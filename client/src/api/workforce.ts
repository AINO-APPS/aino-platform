import type { AxiosResponse } from "axios";
import API, { type AnyData, type Params } from "./client";

// GIF/Sticker search via the server-side GIPHY proxy (key stays server-side).
export type GiphyMedia = { id: string; previewUrl: string; mediaUrl: string };
export const searchGiphy = (q: string, type: "gifs" | "stickers" = "gifs") =>
    API.get<{ results: GiphyMedia[] }>("/giphy/search", { params: { q, type } });
export const trendingGiphy = (type: "gifs" | "stickers" = "gifs") =>
    API.get<{ results: GiphyMedia[] }>("/giphy/trending", { params: { type } });

// Auth
export const login = (data: AnyData) => API.post("/auth/login", data);
export const logoutUser = () => API.post("/auth/logout");
export const refreshToken = () => API.post("/auth/refresh");
export const recordSessionActivity = () => API.post("/auth/activity");
export const forgotPassword = (data: AnyData) => API.post("/auth/forgot-password", data);
export const resetPassword = (data: AnyData) => API.post("/auth/reset-password", data);

// Biometric device credentials (mobile/desktop "login with your face").
// enroll is auth-gated; login is public and exchanges the device secret for a
// session, identical to a password login.
export const biometricEnroll = (data: { platform: string; deviceLabel?: string }) =>
    API.post("/auth/biometric/enroll", data);
export const biometricLogin = (data: { credentialId: string; deviceSecret: string }) =>
    API.post("/auth/biometric/login", data);
export const listBiometricDevices = () => API.get("/auth/biometric");
export const revokeBiometricDevice = (id: string) => API.delete(`/auth/biometric/${id}`);

// Tracker
// getStatus is deduplicated: concurrent calls within the same event loop
// tick share a single HTTP request (e.g. Dashboard + WorkStateContext on mount).
// On failure, the in-flight ref is cleared so subsequent callers can retry.
let _statusInFlight: Promise<AxiosResponse> | null = null;
export const getStatus = (): Promise<AxiosResponse> => {
    if (!_statusInFlight) {
        _statusInFlight = API.get("/tracker/status").then(
            (res) => {
                _statusInFlight = null;
                return res;
            },
            (err) => {
                _statusInFlight = null;
                throw err;
            }
        );
    }
    return _statusInFlight;
};

export interface AttendanceVerificationPayload {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    face_descriptor?: number[] | Float32Array;
    wifi_bssid?: string;
}

interface ClockInPayload extends AttendanceVerificationPayload {
    work_mode?: string;
}
export const clockIn = (payload?: string | ClockInPayload | null) => {
    // Backwards-compat: callers used to pass just the work_mode string.
    if (typeof payload === "string" || payload == null) {
        return API.post("/tracker/clock-in", { work_mode: payload || "office" });
    }
    return API.post("/tracker/clock-in", {
        work_mode: payload.work_mode || "office",
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy,
        face_descriptor: payload.face_descriptor ? Array.from(payload.face_descriptor) : undefined,
        wifi_bssid: payload.wifi_bssid,
    });
};

// Face enrollment for attendance verification (descriptor extracted in
// browser via face-api.js â€” only the 128-float embedding is sent).
export const getFaceStatus = () => API.get("/profile/face-status");
export const enrollFace = (descriptor: number[]) =>
    API.post("/profile/face-enroll", { descriptor });
export const clearFaceEnrollment = () => API.delete("/profile/face-enroll");
export const breakStart = () => API.post("/tracker/break-start");
export const breakEnd = () => API.post("/tracker/break-end");
export const clockOut = (payload: AttendanceVerificationPayload = {}) =>
    API.post("/tracker/clock-out", {
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy,
        face_descriptor: payload.face_descriptor ? Array.from(payload.face_descriptor) : undefined,
        wifi_bssid: payload.wifi_bssid,
    });
export const getHistory = (from?: string, to?: string) =>
    API.get("/tracker/history", { params: { from, to } });
export const getAnalytics = (days?: number, from?: string, to?: string) =>
    API.get("/tracker/analytics", { params: { days, from, to } });

// Manual Entry
export const addManualEntry = (data: AnyData) => API.post("/tracker/manual-entry", data);
export const updateManualEntry = (date: string, data: AnyData) =>
    API.put(`/tracker/manual-entry/${date}`, data);
export const deleteEntries = (date: string) => API.delete(`/tracker/entries/${date}`);
export const getEntries = (date: string) => API.get(`/tracker/entries/${date}`);
export const getManualEntryRequests = () => API.get("/tracker/manual-entries");

// Overtime
export const submitOvertimeRequest = (data: AnyData) =>
    API.post("/tracker/overtime-request", data);
export const getOvertimeRequests = () => API.get("/tracker/overtime-requests");

// Dashboard Widgets
export const getWidgets = () => API.get("/tracker/widgets");
export const getWeeklyChart = () => API.get("/tracker/weekly");
export const getTaskSummary = () => API.get("/tracker/task-summary");

// Theme
export const getTheme = () => API.get("/tracker/theme");
export const updateTheme = (theme: string) => API.put("/tracker/theme", { theme });

// Leaves
// The server's GET /leaves endpoint filters by `start_date` / `end_date`
// (see server/routes/leaves.js). The earlier `from` / `to` aliases were
// silently ignored, which made the manual-entry page think every date had
// a leave on it (it would pick the first leave from the unfiltered list).
export const getLeaves = (from?: string, to?: string) =>
    API.get("/leaves", {
        params: { start_date: from, end_date: to },
    });
export const addLeave = (data: AnyData) => API.post("/leaves", data);
export const addLeavesBatch = (data: AnyData) => API.post("/leaves", data);
export const deleteLeave = (id: number | string) => API.delete(`/leaves/${id}`);
export const withdrawLeave = (id: number | string) => API.post(`/leaves/${id}/withdraw`);
export const getLeaveSummary = (month?: number, year?: number) =>
    API.get("/leaves/summary", { params: { month, year } });
