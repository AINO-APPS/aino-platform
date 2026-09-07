import type { BrowserWindow } from "electron";

export function parseDeepLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "workpulse:" || url.hostname !== "app") return null;
    const path = `${url.pathname || "/"}${url.search}${url.hash}`;
    return `workpulse://app${path.startsWith("/") ? path : `/${path}`}`;
  } catch {
    return null;
  }
}

export function findDeepLink(argv: readonly string[]): string | null {
  for (const value of argv) {
    const link = parseDeepLink(value);
    if (link) return link;
  }
  return null;
}

export function showWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function deliverDeepLink(window: BrowserWindow | null, value: string): boolean {
  const link = parseDeepLink(value);
  if (!window || window.isDestroyed() || !link) return false;
  void window.loadURL(link);
  showWindow(window);
  return true;
}
