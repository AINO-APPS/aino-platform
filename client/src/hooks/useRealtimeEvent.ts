import { useEffect, useRef } from "react";
import { REALTIME_EVENT, type WebSocketMessage } from "./useWebSocket";

/**
 * Subscribe to server realtime events by type without opening another socket.
 * Every app-level useWebSocket connection republishes inbound frames (deduped)
 * as a window `REALTIME_EVENT`, so pages can react to e.g. `leave_update`
 * while the navbar/contexts own the actual connections.
 */
export default function useRealtimeEvent(
  types: readonly string[],
  handler: (msg: WebSocketMessage) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = types.join("|");

  useEffect(() => {
    if (!enabled) return;
    const wanted = new Set(key.split("|"));
    const onRealtime = (event: Event) => {
      const msg = (event as CustomEvent<WebSocketMessage>).detail;
      if (msg && wanted.has(msg.type)) handlerRef.current(msg);
    };
    window.addEventListener(REALTIME_EVENT, onRealtime);
    return () => window.removeEventListener(REALTIME_EVENT, onRealtime);
  }, [key, enabled]);
}
