const DESKTOP_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

interface DesktopLatestManifest {
  version?: unknown;
  tag?: unknown;
}

/**
 * Read and validate the immutable release folder name from latest.json.
 * Never allow pointer content to inject path segments into the update URL.
 */
function getDesktopTag(manifest: DesktopLatestManifest | null): string | null {
  if (!manifest || typeof manifest !== "object") return null;

  const tag =
    typeof manifest.tag === "string"
      ? manifest.tag
      : typeof manifest.version === "string"
        ? `v${manifest.version}`
        : null;

  return tag && DESKTOP_TAG_PATTERN.test(tag) ? tag : null;
}

export { getDesktopTag };
export type { DesktopLatestManifest };
