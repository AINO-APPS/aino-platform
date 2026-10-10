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
    // Only a known approval change makes cached approvals stale enough to toast;
    // opportunistic reconciles fail quietly and widgets show their own errors.
    let batchHasApprovalUpdate = false;
    const refresh = (approvalUpdate = false) => {
      if (approvalUpdate) batchHasApprovalUpdate = true;
      if (timer) return;
      // Multiple feature sockets and desktop focus/visibility events arrive together.
      timer = setTimeout(() => {
        timer = undefined;
        const notify = batchHasApprovalUpdate;
        batchHasApprovalUpdate = false;
        void refreshApprovalQueries(client).catch((err: unknown) => {
          if (disposed) return;
          if (!notify) {
            console.warn("Background approval refresh failed:", err);
            return;
          }
          console.error("Approval refresh failed:", err);
          toast.error("Could not refresh approvals. Please try again.");
        });
      }, 100);
    };
    const reconcile = () => refresh();
    const onRealtime = (event: Event) => {
      const msg = (event as CustomEvent<WebSocketMessage>).detail;
      if (msg?.type === "approval_update") refresh(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(REALTIME_EVENT, onRealtime);
    window.addEventListener(REALTIME_CONNECTED_EVENT, reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = window.electronAPI?.onWindowShown?.(reconcile);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(REALTIME_EVENT, onRealtime);
      window.removeEventListener(REALTIME_CONNECTED_EVENT, reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe?.();
    };
  }, [client, sessionKey, toast]);
}
