import API, { type AnyData, type Params } from "./client";

// Meetings
export const createMeeting = (data: AnyData) => API.post("/meetings", data);
export const checkMeetingConflicts = (data: AnyData) =>
    API.post("/meetings/check-conflicts", data);
export const getMyMeetings = (params?: Params) => API.get("/meetings", { params });
export const getMeeting = (code: string) => API.get(`/meetings/${code}`);
export const updateMeeting = (id: number | string, data: AnyData) =>
    API.put(`/meetings/${id}`, data);
export const cancelMeeting = (id: number | string) => API.delete(`/meetings/${id}`);
export const getMeetingParticipants = (id: number | string) =>
    API.get(`/meetings/${id}/participants`);
export const addMeetingParticipant = (id: number | string, userId: number | string) =>
    API.post(`/meetings/${id}/participants`, { user_id: userId });
export const removeMeetingParticipant = (id: number | string, userId: number | string) =>
    API.delete(`/meetings/${id}/participants/${userId}`);
// Fetch the persisted in-meeting chat history for the meeting's conversation.
// Used by useMeetingState to re-hydrate the chat panel on join/rejoin so
// messages don't appear lost after a refresh or after leaving + rejoining
// during the same session.
export const getMeetingMessages = (code: string, limit = 200) =>
    API.get(`/meetings/${code}/messages`, { params: { limit } });

// Meeting HLS broadcast (videosdk-hls-style large-meeting mode)
export const startMeetingHlsBroadcast = (code: string) => API.post(`/meetings/${code}/hls/start`);
export const stopMeetingHlsBroadcast = (code: string, broadcastId: number | string) =>
    API.post(`/meetings/${code}/hls/stop`, { broadcastId });
export const getMeetingHlsStatus = (code: string) => API.get(`/meetings/${code}/hls/status`);

// â”€â”€â”€ Branding & email templates (Chunk 3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// `getBranding` is GET-only and is also called by the unauthenticated
// AuthContext bootstrap on first load to apply the org accent + logo before
// the user is even authenticated; the server only allows it for
// authenticated org members so it returns 401 pre-login (which we handle).
export const getBranding = () => API.get("/branding");
// Public branding (no auth) â€” used to theme the login / register pages with
// the org's accent color before the user signs in. Returns nulls on the
// master / default domain so callers can safely fall back to defaults.
export const getPublicBranding = (slug?: string) =>
    API.get("/public/branding", slug ? { params: { slug } } : undefined);
export const updateBrandingAccent = (accent_color: string) =>
    API.put("/branding", { accent_color });
export const uploadBrandingLogo = (file: File) => {
    const fd = new FormData();
    fd.append("logo", file);
    return API.post("/branding/logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
    });
};
export const deleteBrandingLogo = () => API.delete("/branding/logo");
export const getEmailTemplates = () => API.get("/branding/email-templates");
export const updateEmailTemplate = (key: string, data: AnyData) =>
    API.put(`/branding/email-templates/${encodeURIComponent(key)}`, data);
export const revertEmailTemplate = (key: string) =>
    API.delete(`/branding/email-templates/${encodeURIComponent(key)}`);
export const previewEmailTemplate = (key: string, data?: AnyData) =>
    API.post(`/branding/email-templates/${encodeURIComponent(key)}/preview`, data || {});
