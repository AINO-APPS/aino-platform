import { app, BrowserWindow, nativeImage } from "electron";
import path from "path";
import { sendIpc } from "./ipc-contract";
import { createWindowStateSaver, loadWindowState } from "./windowState";
import { secureWindowNavigation, type OpenUpload } from "./navigationSecurity";
import { findDeepLink } from "./deepLinks";

export interface MainWindowOptions { dirname: string; stateFile: string; apiServer: string; openUpload: OpenUpload }

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const state = loadWindowState(options.stateFile);
  const saveState = createWindowStateSaver(options.stateFile);
  const window = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: 800, minHeight: 600, title: "",
    icon: nativeImage.createFromPath(path.join(options.dirname, "icons", process.platform === "win32" ? "icon.ico" : "icon.png")),
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    webPreferences: {
      preload: path.join(options.dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
    show: false,
  });
  if (state.isMaximized) window.maximize();
  void window.loadURL(findDeepLink(process.argv) || "workpulse://app/");
  if (!app.isPackaged) window.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" && input.type === "keyDown") { window.webContents.toggleDevTools(); event.preventDefault(); }
  });
  window.on("page-title-updated", event => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("resize", () => saveState(window));
  window.on("move", () => saveState(window));
  window.on("maximize", () => sendIpc(window.webContents, "maximize-change", true));
  window.on("unmaximize", () => sendIpc(window.webContents, "maximize-change", false));
  const notifyHidden = (reason: string) => {
    if (!window.isDestroyed()) sendIpc(window.webContents, "window-hidden", { reason });
  };
  const notifyShown = (reason: string) => {
    if (!window.isDestroyed()) sendIpc(window.webContents, "window-shown", { reason });
  };
  window.on("minimize", () => notifyHidden("minimize"));
  window.on("hide", () => notifyHidden("hide"));
  window.on("restore", () => notifyShown("restore"));
  window.on("show", () => notifyShown("show"));
  window.on("focus", () => notifyShown("focus"));
  window.on("close", event => { if (!app.isQuitting) { event.preventDefault(); window.hide(); } });
  secureWindowNavigation(window, options.apiServer, options.openUpload);
  return window;
}
