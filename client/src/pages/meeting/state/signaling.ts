export const OUTBOUND_QUEUE_MAX = 500;

export interface SignalingFrame {
  type: string;
  data?: unknown;
}

const REAL_TURN_MODES = new Set(["cloudflare-calls", "coturn-rest", "static"]);

export function hasRealTurn(
  config:
    | {
        iceServers?: RTCIceServer[];
        mode?: string;
      }
    | null
    | undefined,
): boolean {
  const servers = Array.isArray(config?.iceServers) ? config.iceServers : [];
  if (config?.mode && REAL_TURN_MODES.has(config.mode)) return true;
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(
      (url) =>
        typeof url === "string" &&
        /^turns?:/i.test(url) &&
        !url.toLowerCase().includes("openrelay.metered.ca"),
    );
  });
}

export function applyPublicTurnPolicy(
  servers: RTCIceServer[],
  allowPublicTurn: boolean,
): RTCIceServer[] {
  if (allowPublicTurn) return servers;
  const filtered: RTCIceServer[] = [];
  for (const server of servers) {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const kept = urls.filter(
      (url) =>
        typeof url === "string" &&
        !url.toLowerCase().includes("openrelay.metered.ca"),
    );
    if (kept.length > 0)
      filtered.push({ ...server, urls: kept.length === 1 ? kept[0] : kept });
  }
  return filtered;
}

export function queueSignalingFrame(
  queue: SignalingFrame[],
  frame: SignalingFrame,
  maximum = OUTBOUND_QUEUE_MAX,
): void {
  queue.push(frame);
  if (queue.length > maximum) queue.splice(0, queue.length - maximum);
}
