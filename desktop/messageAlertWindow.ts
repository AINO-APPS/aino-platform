import { app, BrowserWindow, screen } from "electron";
import path from "path";
import { onIpc, sendIpc } from "./ipc-contract";
import type { MessageAlertState } from "./ipc-types";
import { isMessageAlertAction, isMessageAlertState, messagePopupBounds } from "./messageAlertPolicy";
import { secureWindowNavigation, type OpenUpload } from "./navigationSecurity";

export function setupMessageAlertWindow(main: BrowserWindow, apiServer: string, openUpload: OpenUpload): void {
  let popup: BrowserWindow | null = null;
  let state: MessageAlertState | null = null;
  let ready = false;
  let measuredHeight: number | null = null;
  const clear = () => {
    state = null;
    ready = false;
    measuredHeight = null;
    const window = popup;
    popup = null;
    if (window && !window.isDestroyed()) window.destroy();
  };
  const publish = () => {
    if (!popup || popup.isDestroyed() || !state || !ready) return;
    sendIpc(popup.webContents, "messages:state", state);
    popup.showInactive();
  };
  onIpc("messages:publish", (event, payload) => {
    if (event.sender !== main.webContents || !isMessageAlertState(payload)) {
      console.warn("[AINO] Rejected message notification state"); return;
    }
    if (!payload.cards.length) { clear(); return; }
    if (state?.cards.length !== payload.cards.length) measuredHeight = null;
    state = payload;
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const bounds = messagePopupBounds(area, payload.cards.length);
    if (measuredHeight !== null) {
      bounds.height = Math.min(area.height - 32, measuredHeight);
      bounds.y = area.y + area.height - bounds.height - 16;
    }
    if (!popup || popup.isDestroyed()) {
      ready = false;
      popup = new BrowserWindow({
        ...bounds, frame: false, resizable: false, minimizable: false, maximizable: false,
        fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
        transparent: true, hasShadow: false, title: "AINO Messages",
        webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true,
          nodeIntegration: false, backgroundThrottling: false },
      });
      secureWindowNavigation(popup, apiServer, openUpload);
      const owned = popup;
      owned.on("closed", () => {
        if (popup === owned) { popup = null; ready = false; }
      });
      owned.webContents.on("render-process-gone", () => { console.error("[AINO] Notification renderer exited"); clear(); });
      void owned.loadURL("workpulse://app/message-popup").catch((error: unknown) => {
        console.error("[AINO] Notification window failed to load", error); clear();
      });
    } else popup.setBounds(bounds);
    publish();
  });
  onIpc("messages:ready", (event) => {
    if (event.sender !== popup?.webContents) return;
    ready = true;
    publish();
  });
  onIpc("messages:resize", (event, height) => {
    if (event.sender !== popup?.webContents || !popup || !Number.isSafeInteger(height) || height < 1 || height > 3000) return;
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const bounds = messagePopupBounds(area, state?.cards.length ?? 1);
    measuredHeight = Math.min(bounds.height, Math.max(100, height));
    bounds.height = measuredHeight;
    bounds.y = area.y + area.height - measuredHeight - 16;
    popup.setBounds(bounds);
  });
  onIpc("messages:action", (event, action) => {
    if (event.sender !== popup?.webContents || !isMessageAlertAction(action, state)) {
      console.warn("[AINO] Rejected message notification action"); return;
    }
    if (!main.isDestroyed()) sendIpc(main.webContents, "messages:action", action);
  });
  onIpc("messages:clear", (event) => { if (event.sender === main.webContents) clear(); });
  main.webContents.on("render-process-gone", clear);
  main.webContents.on("did-start-loading", clear);
  main.on("closed", clear);
  app.on("before-quit", clear);
}
