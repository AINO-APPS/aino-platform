import type { ExtWS } from "./types";

/** Local-instance sockets keyed by tenant and user. Cross-instance delivery is fanout's concern. */
const clients = new Map<string, Set<ExtWS>>();

function clientKey(tenantId: number | null | undefined, userId: number): string {
  return `${tenantId || 0}:${userId}`;
}

function connectionsFor(tenantId: number | null | undefined, userId: number): Set<ExtWS> | undefined {
  return clients.get(clientKey(tenantId, userId));
}

function registerConnection(
  tenantId: number | null | undefined,
  userId: number,
  ws: ExtWS,
  limit: number,
): { accepted: boolean; wasOffline: boolean } {
  const key = clientKey(tenantId, userId);
  const existing = clients.get(key);
  const wasOffline = !existing || existing.size === 0;
  const connections = existing || new Set<ExtWS>();
  if (connections.size >= limit) return { accepted: false, wasOffline };
  if (!existing) clients.set(key, connections);
  connections.add(ws);
  return { accepted: true, wasOffline };
}

function unregisterConnection(
  tenantId: number | null | undefined,
  userId: number,
  ws: ExtWS,
): boolean {
  const key = clientKey(tenantId, userId);
  const connections = clients.get(key);
  if (!connections) return true;
  connections.delete(ws);
  if (connections.size > 0) return false;
  clients.delete(key);
  return true;
}

function hasOpenSocket(tenantId: number | null | undefined, userId: number): boolean {
  const connections = connectionsFor(tenantId, userId);
  return Boolean(connections && [...connections].some((ws) => ws.readyState === 1));
}

export {
  clients,
  clientKey,
  connectionsFor,
  registerConnection,
  unregisterConnection,
  hasOpenSocket,
};
