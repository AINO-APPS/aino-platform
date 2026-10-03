/**
 * Relative web paths stored in `notifications.link` and sent as the FCM `link`
 * key. Clients (web + mobile) open these on tap, so they must always be
 * relative ("/…") and match a route the web client handles.
 */
export const LEAVES_LINK = "/attendance#leaves";
export const MANUAL_ENTRY_LINK = "/attendance#manual-entry";
/** Agile editor access requests/grants are reviewed in Admin → Agile Config. */
export const AGILE_ACCESS_LINK = "/admin?tab=agile";

export function taskLink(taskId: number | string): string {
    return `/tasks?task=${encodeURIComponent(String(taskId))}`;
}

export function noteLink(pageId: number | string): string {
    return `/notes?pageId=${encodeURIComponent(String(pageId))}`;
}

export function approvalLink(approvalRequestId?: number | string | null): string {
    return approvalRequestId != null && approvalRequestId !== ""
        ? `/manager?tab=approvals&request=${encodeURIComponent(String(approvalRequestId))}`
        : "/manager?tab=approvals";
}
