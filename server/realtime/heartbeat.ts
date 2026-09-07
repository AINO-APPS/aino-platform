import type { ExtWS } from "./types";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;

interface HeartbeatServer {
  clients: Set<ExtWS>;
  on(event: string, listener: () => void): void;
}

interface HeartbeatDependencies {
  onProofOfLife(ws: ExtWS): void;
  revalidate(ws: ExtWS): Promise<void>;
  onTerminate(ws: ExtWS): void;
}

function markAlive(ws: ExtWS): void {
  ws.isAlive = true;
  ws._missedPongs = 0;
}

function handleApplicationPing(ws: ExtWS): boolean {
  markAlive(ws);
  try {
    ws.send(JSON.stringify({ type: "pong" }));
  } catch {
    // Socket teardown will perform canonical cleanup.
  }
  return true;
}

function attachSocketHeartbeat(ws: ExtWS, onProofOfLife: (ws: ExtWS) => void): void {
  ws.isAlive = true;
  ws.on("pong", () => {
    markAlive(ws);
    onProofOfLife(ws);
  });
}

function startHeartbeat(server: HeartbeatServer, dependencies: HeartbeatDependencies): NodeJS.Timeout {
  const timer = setInterval(() => {
    server.clients.forEach((ws) => {
      ws._missedPongs = (ws._missedPongs || 0) + (ws.isAlive ? 0 : 1);
      if (ws._missedPongs > MAX_MISSED_PONGS) {
        dependencies.onTerminate(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      void dependencies.revalidate(ws);
      try {
        ws.ping();
      } catch {
        // Socket teardown will perform canonical cleanup.
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
  server.on("close", () => clearInterval(timer));
  return timer;
}

export {
  HEARTBEAT_INTERVAL_MS,
  MAX_MISSED_PONGS,
  markAlive,
  handleApplicationPing,
  attachSocketHeartbeat,
  startHeartbeat,
};
