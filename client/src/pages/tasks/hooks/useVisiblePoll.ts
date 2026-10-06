import { useEffect, useRef } from "react";

/**
 * Calls `refresh` every `intervalMs` while the tab/window is visible, and once
 * when it becomes visible again. Covers changes the server never pushes to this
 * user — teammates' edits on a shared board (`task_updated` only reaches the
 * assignee, creator and actor), sprint lifecycle and Service Desk updates.
 */
export function useVisiblePoll(refresh: () => void, intervalMs = 30_000, enabled = true): void {
  const ref = useRef(refresh);
  ref.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => ref.current(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        ref.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
