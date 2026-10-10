import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useToast } from "../components/common/Toast";
import { REALTIME_EVENT, REALTIME_CONNECTED_EVENT, type WebSocketMessage } from "./useWebSocket";

export function refreshApprovalQueries(client: QueryClient): Promise<void[]> {
  return Promise.all([
    ["manager", "approvals"],
    ["admin", "home", "stats"],
    ["manager", "teamAnalytics"],
  ].map((queryKey) => client.invalidateQueries({ queryKey }, { throwOnError: true })));
}

/** Reconcile missed approval events without changing unrelated query freshness. */
export default function useApprovalSync(sessionKey: string | null): void {
  const client = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!sessionKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refresh = () => {
      if (timer) return;
      // Multiple feature sockets and desktop focus/visibility events arrive together.
      timer = setTimeout(() => {
        timer = undefined;
        void refreshApprovalQueries(client).catch((err: unknown) => {
          if (disposed) return;
          console.error("Approval refresh failed:", err);
          toast.error("Could not refresh approvals. Please try again.");
        });
      }, 100);
    };
    const onRealtime = (event: Event) => {
      const msg = (event as CustomEvent<WebSocketMessage>).detail;
      if (msg?.type === "approval_update") refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(REALTIME_EVENT, onRealtime);
    window.addEventListener(REALTIME_CONNECTED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = window.electronAPI?.onWindowShown?.(refresh);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(REALTIME_EVENT, onRealtime);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe?.();
    };
  }, [client, sessionKey, toast]);
}
