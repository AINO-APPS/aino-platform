/** Fallback used only when the authenticated ICE-config endpoint is unavailable. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

const REAL_TURN_MODES = new Set(["cloudflare-calls", "coturn-rest", "static"]);

/** Enforce the server-owned policy without accidentally removing STUN entries. */
export function applyPublicTurnPolicy(
  servers: RTCIceServer[],
  allowPublic: boolean,
): RTCIceServer[] {
  if (allowPublic) return servers;
  return (servers || []).flatMap((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    const kept = urls.filter(
      (url) =>
        typeof url === "string" &&
        !url.toLowerCase().includes("openrelay.metered.ca"),
    );
    return kept.length
      ? [{ ...server, urls: kept.length === 1 ? kept[0] : kept }]
      : [];
  });
}

/** Detect managed TURN, retaining compatibility with servers predating `mode`. */
export function hasRealTurn(
  config: { mode?: string; iceServers?: RTCIceServer[] } | null | undefined,
): boolean {
  if (!config) return false;
  if (config.mode && REAL_TURN_MODES.has(config.mode)) return true;
  return (config.iceServers || []).some((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some((url) => {
      if (typeof url !== "string") return false;
      const value = url.toLowerCase();
      return (
        (value.startsWith("turn:") || value.startsWith("turns:")) &&
        !value.includes("openrelay.metered.ca")
      );
    });
  });
}