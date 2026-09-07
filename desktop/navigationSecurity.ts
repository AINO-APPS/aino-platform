import { shell, type BrowserWindow } from "electron";
import { isAllowedAppNavigation } from "./protocolUtils";

export type OpenUpload = (path: string) => Promise<void>;

export function classifyWindowOpen(url: string, apiServer: string): { kind: "upload" | "external" | "deny"; value?: string } {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const ownHost = parsed.protocol === "workpulse:" && parsed.hostname === "app" || parsed.host === new URL(apiServer).host;
    if (ownHost && pathname.startsWith("/uploads/")) return { kind: "upload", value: pathname + parsed.search };
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return { kind: "external", value: url };
  } catch { /* deny malformed URLs */ }
  return { kind: "deny" };
}

export function secureWindowNavigation(window: BrowserWindow, apiServer: string, openUpload: OpenUpload): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyWindowOpen(url, apiServer);
    if (decision.kind === "upload") void openUpload(decision.value!).catch(err => console.error("[AINO] Failed to open uploaded file:", err?.message));
    if (decision.kind === "external") void shell.openExternal(decision.value!);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) event.preventDefault();
  });
}
