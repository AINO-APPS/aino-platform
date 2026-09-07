import type { App, BrowserWindow } from "electron";
import { deliverDeepLink, findDeepLink, showWindow } from "./deepLinks";

export function setupLifecycle(app: App, getWindow: () => BrowserWindow | null): boolean {
  app.on("activate", () => showWindow(getWindow()));
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverDeepLink(getWindow(), url);
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient("workpulse");
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return false;
  }
  app.on("second-instance", (_event, argv) => {
    const window = getWindow();
    const link = findDeepLink(argv);
    if (!link || !deliverDeepLink(window, link)) showWindow(window);
  });
  app.on("before-quit", () => { app.isQuitting = true; });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  return true;
}
