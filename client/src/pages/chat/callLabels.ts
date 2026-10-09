/**
 * Signal-style call history wording (Android `CallHistoryLabels.kt`), shared by
 * the Calls tab and the chat-info call history.
 */
export interface CallLabel {
    title: string;
    /** Duration (m:ss), "No answer", "Declined", "Ongoing", or undefined. */
    duration?: string;
    when: string;
    outgoing: boolean;
    video: boolean;
    /** Only a call that rang here unanswered is shown in the danger colour. */
    missed: boolean;
}

export function formatCallDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function fmtWhen(ts?: string | null): string {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function callLabel(
    call: { call_type?: string; status?: string; duration?: number | null; caller_id?: number | string; created_at?: string; started_at?: string },
    currentUserId?: number | string | null,
): CallLabel {
    const video = call.call_type === "video";
    const kind = video ? "video call" : "voice call";
    const outgoing = call.caller_id != null && currentUserId != null && String(call.caller_id) === String(currentUserId);
    const direction = outgoing ? `Outgoing ${kind}` : `Incoming ${kind}`;
    const when = fmtWhen(call.started_at || call.created_at);
    const dur = call.duration && call.duration > 0 ? formatCallDuration(call.duration) : undefined;
    switch (call.status) {
        case "ringing":
        case "answered":
            return { title: direction, duration: "Ongoing", when, outgoing, video, missed: false };
        case "missed":
        case "no_answer":
            return outgoing
                ? { title: direction, duration: "No answer", when, outgoing, video, missed: false }
                : { title: `Missed ${kind}`, when, outgoing, video, missed: true };
        case "declined":
        case "rejected":
            return outgoing
                ? { title: direction, duration: "Declined", when, outgoing, video, missed: false }
                : { title: `Declined ${kind}`, when, outgoing, video, missed: false };
        default:
            return { title: direction, duration: dur, when, outgoing, video, missed: false };
    }
}
