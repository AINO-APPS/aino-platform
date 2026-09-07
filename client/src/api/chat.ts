import API, { type AnyData } from "./client";

// Chat
export const searchChatUsers = (q: string) => API.get("/chat/search", { params: { q } });
export const getPresence = (userIds: (number | string)[]) =>
    API.get("/chat/presence", { params: { userIds: userIds.join(",") } });
export const getUserStatus = () => API.get("/chat/status");
// PR7: removed `updateUserStatus` (PUT /chat/status). The v2 client uses
// `client/src/status/api.js` â†’ setMyStatus (PUT /api/me/status) instead.
export const getConversations = () => API.get("/chat/conversations");
export const createConversation = (userId: number | string) =>
    API.post("/chat/conversations", { userId });
export const createGroup = (name: string, userIds: (number | string)[]) =>
    API.post("/chat/conversations/group", { name, userIds });
export const updateGroup = (convId: number | string, data: AnyData) =>
    API.put(`/chat/conversations/${convId}/group`, data);
export const getMembers = (convId: number | string) =>
    API.get(`/chat/conversations/${convId}/members`);
// Group management (Phase 1): leave, role change, ownership transfer.
export const leaveGroup = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/leave`);
export const setGroupRole = (
    convId: number | string,
    userId: number | string,
    role: "admin" | "member",
) => API.put(`/chat/conversations/${convId}/participants/${userId}/role`, { role });
export const transferGroupOwner = (convId: number | string, userId: number | string) =>
    API.post(`/chat/conversations/${convId}/transfer-owner`, { userId });
export const getMessages = (convId: number | string, before?: string) =>
    API.get(`/chat/conversations/${convId}/messages`, { params: { before } });
export const markConversationRead = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/read`);
export const getReadStatus = (convId: number | string) =>
    API.get(`/chat/conversations/${convId}/read-status`);
export const uploadChatFile = (
    convId: number | string,
    formData: FormData,
    opts?: {
        signal?: AbortSignal;
        onUploadProgress?: (evt: { loaded: number; total?: number }) => void;
    },
) =>
    API.post(`/chat/conversations/${convId}/files`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        signal: opts?.signal,
        onUploadProgress: opts?.onUploadProgress as
            | ((progressEvent: unknown) => void)
            | undefined,
    });
export const cancelChatMediaJob = (mediaJobId: number | string) =>
    API.post(`/chat/media-jobs/${mediaJobId}/cancel`);
export const retryChatMediaJob = (mediaJobId: number | string) =>
    API.post(`/chat/media-jobs/${mediaJobId}/retry`);
export const toggleReaction = (msgId: number | string, emoji: string) =>
    API.post(`/chat/messages/${msgId}/reactions`, { emoji });
export const editMessage = (msgId: number | string, content: string) =>
    API.put(`/chat/messages/${msgId}`, { content });
export const deleteMessage = (msgId: number | string) => API.delete(`/chat/messages/${msgId}`);
export const togglePin = (msgId: number | string) => API.post(`/chat/messages/${msgId}/pin`);
export const markMessageViewed = (msgId: number | string) =>
    API.post<{ fileUrl?: string; viewed?: boolean }>(`/chat/messages/${msgId}/view`);
export const getPinnedMessages = (convId: number | string) =>
    API.get(`/chat/conversations/${convId}/pinned`);
export const searchMessages = (q: string, convId?: number | string) =>
    API.get("/chat/search-messages", { params: { q, convId } });
export const forwardMessage = (msgId: number | string, conversationIds: (number | string)[]) =>
    API.post(`/chat/messages/${msgId}/forward`, { conversationIds });
export const toggleStar = (msgId: number | string) => API.post(`/chat/messages/${msgId}/star`);
export const getStarredMessages = () => API.get("/chat/starred");
export const createPoll = (convId: number | string, data: AnyData) =>
    API.post(`/chat/conversations/${convId}/polls`, data);
export const votePoll = (pollId: number | string, optionIdx: number) =>
    API.post(`/chat/polls/${pollId}/vote`, { optionIdx });
export const getPoll = (pollId: number | string) => API.get(`/chat/polls/${pollId}`);
export const getSharedFiles = (convId: number | string) =>
    API.get(`/chat/conversations/${convId}/files`);
export const ackDelivered = (msgId: number | string) =>
    API.post(`/chat/messages/${msgId}/delivered`);
export const deleteConversation = (convId: number | string) =>
    API.delete(`/chat/conversations/${convId}`);
export const clearChat = (convId: number | string) =>
    API.delete(`/chat/conversations/${convId}/messages`);
export const togglePinConversation = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/pin`);
export const toggleFavouriteConversation = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/favourite`);
// Mute with Signal-style durations: "1h" | "8h" | "1d" | "1w" | "always";
// pass null to unmute. Omit the argument for legacy toggle behaviour.
export const muteConversation = (
    convId: number | string,
    duration?: "1h" | "8h" | "1d" | "1w" | "always" | null,
) =>
    duration === undefined
        ? API.post(`/chat/conversations/${convId}/mute`)
        : API.post(`/chat/conversations/${convId}/mute`, { duration });
export const toggleArchiveConversation = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/archive`);
export const markConversationUnread = (convId: number | string) =>
    API.post(`/chat/conversations/${convId}/unread`);
// Block users (Signal parity)
export const getBlockedUsers = () => API.get("/chat/blocked");
export const blockUser = (userId: number | string) =>
    API.post(`/chat/users/${userId}/block`);
export const unblockUser = (userId: number | string) =>
    API.delete(`/chat/users/${userId}/block`);
// Link preview (sender-generated, Signal parity)
export const getLinkPreview = (url: string) =>
    API.get("/chat/link-preview", { params: { url } });
export const getCallHistory = (convId: number | string) =>
    API.get(`/chat/conversations/${convId}/calls`);
export const getAllCallHistory = () => API.get("/chat/calls");
export const deleteCalls = (selection: number[] | { all: true }) =>
    API.post("/chat/calls/delete", Array.isArray(selection) ? { ids: selection } : selection);
export const getActiveCall = () => API.get("/chat/calls/active");
export const getIceConfig = () => API.get("/chat/ice-config");
