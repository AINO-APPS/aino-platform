"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const ipc_contract_1 = require("./ipc-contract");
const windowState_1 = require("./windowState");
const navigationSecurity_1 = require("./navigationSecurity");
const deepLinks_1 = require("./deepLinks");
function createMainWindow(options) {
    const state = (0, windowState_1.loadWindowState)(options.stateFile);
    const saveState = (0, windowState_1.createWindowStateSaver)(options.stateFile);
    const window = new electron_1.BrowserWindow({
        width: state.width, height: state.height, x: state.x, y: state.y,
        minWidth: 800, minHeight: 600, title: "",
        icon: electron_1.nativeImage.createFromPath(path_1.default.join(options.dirname, "icons", process.platform === "win32" ? "icon.ico" : "icon.png")),
        frame: process.platform === "darwin",
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
        webPreferences: {
            preload: path_1.default.join(options.dirname, "preload.js"),
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            backgroundThrottling: false,
        },
        show: false,
    });
    if (state.isMaximized)
        window.maximize();
    void window.loadURL((0, deepLinks_1.findDeepLink)(process.argv) || "workpulse://app/");
    if (!electron_1.app.isPackaged)
        window.webContents.on("before-input-event", (event, input) => {
            if (input.key === "F12" && input.type === "keyDown") {
                window.webContents.toggleDevTools();
                event.preventDefault();
            }
        });
    window.on("page-title-updated", event => event.preventDefault());
    window.once("ready-to-show", () => window.show());
    window.on("resize", () => saveState(window));
    window.on("move", () => saveState(window));
    window.on("maximize", () => (0, ipc_contract_1.sendIpc)(window.webContents, "maximize-change", true));
    window.on("unmaximize", () => (0, ipc_contract_1.sendIpc)(window.webContents, "maximize-change", false));
    const notifyHidden = (reason) => {
        if (!window.isDestroyed())
            (0, ipc_contract_1.sendIpc)(window.webContents, "window-hidden", { reason });
    };
    const notifyShown = (reason) => {
        if (!window.isDestroyed())
            (0, ipc_contract_1.sendIpc)(window.webContents, "window-shown", { reason });
    };
    window.on("minimize", () => notifyHidden("minimize"));
    window.on("hide", () => notifyHidden("hide"));
    window.on("restore", () => notifyShown("restore"));
    window.on("show", () => notifyShown("show"));
    window.on("focus", () => notifyShown("focus"));
    window.on("close", event => { if (!electron_1.app.isQuitting) {
        event.preventDefault();
        window.hide();
    } });
    (0, navigationSecurity_1.secureWindowNavigation)(window, options.apiServer, options.openUpload);
    return window;
}
//# sourceMappingURL=windows.js.map