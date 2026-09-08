export const PEER_CONNECT_TIMEOUT_MS = 30_000;

export interface PeerRecoveryTimers {
  _disconnectTimer?: ReturnType<typeof setTimeout> | null;
  _relayRetryTimer?: ReturnType<typeof setTimeout> | null;
  _connectTimeoutTimer?: ReturnType<typeof setTimeout> | null;
}

/** Clear timers before closing or rebuilding a peer so stale callbacks cannot win. */
export function clearPeerRecoveryTimers(peer: PeerRecoveryTimers): void {
  if (peer._disconnectTimer) clearTimeout(peer._disconnectTimer);
  if (peer._relayRetryTimer) clearTimeout(peer._relayRetryTimer);
  if (peer._connectTimeoutTimer) clearTimeout(peer._connectTimeoutTimer);
  peer._disconnectTimer = null;
  peer._relayRetryTimer = null;
  peer._connectTimeoutTimer = null;
}
