import axios from "axios";
import API, { baseURL, type AnyData, type Params } from "./client";

// Notes
export const getNotes = () => API.get("/notes");
export const saveNotes = (data: AnyData) => API.put("/notes", { data });
export const getPageHistory = (pageId: string) =>
    API.get(`/notes/history/${encodeURIComponent(pageId)}`);
export const getHistorySnapshot = (snapshotId: number | string) =>
    API.get(`/notes/history/snapshot/${snapshotId}`);
export const getMentionableUsers = () => API.get("/notes/mentionable-users");
export const sendNoteMention = (
    mentionedUserId: number | string,
    pageId: string,
    pageTitle: string
) => API.post("/notes/mention", { mentionedUserId, pageId, pageTitle });

// Notes â€” Tier 6 integrations
export const getNoteLinks = (pageId: string) =>
    API.get(`/notes/links/${encodeURIComponent(pageId)}`);
export const addNoteLink = (pageId: string, entityType: string, entityId: number | string) =>
    API.post("/notes/links", { pageId, entityType, entityId });
export const removeNoteLink = (pageId: string, entityType: string, entityId: number | string) =>
    API.delete("/notes/links", { data: { pageId, entityType, entityId } });
export const getDailyPrefill = () => API.get("/notes/daily-prefill");
export const getOneOnOnePrefill = (userId: number | string) =>
    API.get(`/notes/oneonone-prefill/${userId}`);
export const getTimeSummary = () => API.get("/notes/time-summary");
export const convertToTask = (title: string, pageId: string, pageTitle: string) =>
    API.post("/notes/convert-to-task", { title, pageId, pageTitle });
export const getSprintEmbed = () => API.get("/notes/sprint-embed");
export const searchNoteTasks = (q: string) => API.get("/notes/search-tasks", { params: { q } });
export const searchNoteMeetings = (q: string) =>
    API.get("/notes/search-meetings", { params: { q } });
export const searchNoteEvents = (q: string) => API.get("/notes/search-events", { params: { q } });
export const getDirectReports = () => API.get("/notes/direct-reports");

// Public note share links (Chunk 5)
export const getNoteShare = (pageId: string) =>
    API.get(`/notes/share/${encodeURIComponent(pageId)}`);
export const createNoteShare = (pageId: string) =>
    API.post(`/notes/share/${encodeURIComponent(pageId)}`);
export const revokeNoteShare = (pageId: string) =>
    API.delete(`/notes/share/${encodeURIComponent(pageId)}`);
// Public read-only note viewer â€” uses a separate axios instance with no
// CSRF header / no credentials, so it works anonymously.
export const getPublicNote = (token: string) =>
    axios.get(`${baseURL}/public/notes/${encodeURIComponent(token)}`);

// Calendar
export const getCalendarEvents = (from?: string, to?: string) =>
    API.get("/calendar", { params: { from, to } });
export const createCalendarEvent = (data: AnyData) => API.post("/calendar", data);
export const updateCalendarEvent = (id: number | string, data: AnyData) =>
    API.put(`/calendar/${id}`, data);
export const deleteCalendarEvent = (id: number | string) => API.delete(`/calendar/${id}`);

// Notifications
export const getNotifications = () => API.get("/notifications");
export const markNotificationRead = (id: number | string) =>
    API.post(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => API.post("/notifications/read-all");
export const deleteNotification = (id: number | string) => API.delete(`/notifications/${id}`);
export const getNotificationMetrics = (hours = 24) =>
    API.get("/notifications/metrics", { params: { hours } });
export const getActiveAnnouncements = () => API.get("/notifications/announcements");

// Export
export const exportMyAnalytics = (params?: Params) =>
    API.get("/export/my-analytics", { params, responseType: "blob" });
export const exportMyLeaves = (params?: Params) =>
    API.get("/export/my-leaves", { params, responseType: "blob" });
export const exportMyTasks = (params?: Params) =>
    API.get("/export/my-tasks", { params, responseType: "blob" });
export const exportTeamAnalytics = (params?: Params) =>
    API.get("/export/team-analytics", { params, responseType: "blob" });
export const exportTeamLeaves = (params?: Params) =>
    API.get("/export/team-leaves", { params, responseType: "blob" });
export const exportPayrollHours = (from?: string, to?: string, format = "csv") =>
    API.get("/export/payroll-hours", { params: { from, to, format }, responseType: "blob" });

// Global Search
export const globalSearch = (q: string, signal?: AbortSignal) =>
    API.get("/search", { params: { q }, ...(signal && { signal }) });

// Pay Periods
export const getPayPeriods = () => API.get("/admin/pay-periods");
export const createPayPeriod = (data: AnyData) => API.post("/admin/pay-periods", data);
export const deletePayPeriod = (id: number | string) => API.delete(`/admin/pay-periods/${id}`);
