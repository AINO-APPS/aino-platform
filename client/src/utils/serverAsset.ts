import { serverURL } from "../api/client";

/**
 * Resolve a server-relative asset path ("/uploads/…") against the API host.
 * Web builds use an empty `serverURL` (same origin); desktop builds point at
 * the remote server. Absolute, blob: and data: URLs pass through unchanged.
 */
export function resolveServerAsset(url: string | null | undefined): string {
    if (!url) return "";
    return url.startsWith("/") && !url.startsWith("//") ? `${serverURL}${url}` : url;
}
