/**
 * Android `ChatMediaMemory` parity: remembers the local blob: preview of media
 * this client just uploaded, keyed by the server URL, so the bubble keeps
 * showing the local pixels until the remote copy has loaded (no gray flash).
 * Bounded LRU; evicted blobs are revoked.
 */
const MAX_ENTRIES = 50;
const memory = new Map<string, string>();

export function rememberLocalMedia(remoteUrl: string, blobUrl: string): void {
    const previous = memory.get(remoteUrl);
    if (previous && previous !== blobUrl) URL.revokeObjectURL(previous);
    memory.delete(remoteUrl);
    memory.set(remoteUrl, blobUrl);
    while (memory.size > MAX_ENTRIES) {
        const [oldestKey, oldestBlob] = memory.entries().next().value as [string, string];
        memory.delete(oldestKey);
        URL.revokeObjectURL(oldestBlob);
    }
}

export function localMediaFor(remoteUrl: string | null | undefined): string | undefined {
    return remoteUrl ? memory.get(remoteUrl) : undefined;
}

/**
 * Upload finished: keep the blob for image/video so the bubble can swap to the
 * remote URL seamlessly; anything else (voice, documents) is revoked at once.
 */
export function handOffLocalPreview(uploaded: { file_url?: unknown; file_type?: unknown } | null | undefined, blobUrl: string): void {
    const remoteUrl = typeof uploaded?.file_url === "string" ? uploaded.file_url : "";
    const type = typeof uploaded?.file_type === "string" ? uploaded.file_type : "";
    if (remoteUrl && remoteUrl !== blobUrl && (type.startsWith("image/") || type.startsWith("video/"))) {
        rememberLocalMedia(remoteUrl, blobUrl);
    } else {
        URL.revokeObjectURL(blobUrl);
    }
}
