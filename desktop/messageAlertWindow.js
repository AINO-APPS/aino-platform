"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMessageAlertWindow = setupMessageAlertWindow;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const ipc_contract_1 = require("./ipc-contract");
const messageAlertPolicy_1 = require("./messageAlertPolicy");
const navigationSecurity_1 = require("./navigationSecurity");
function setupMessageAlertWindow(main, apiServer, openUpload) {
    let popup = null;
    let state = null;
    let ready = false;
    let measuredHeight = null;
    const clear = () => {
        state = null;
        ready = false;
        measuredHeight = null;
        const window = popup;
        popup = null;
        if (window && !window.isDestroyed())
            window.destroy();
    };
    const publish = () => {
        if (!popup || popup.isDestroyed() || !state || !ready)
            return;
        (0, ipc_contract_1.sendIpc)(popup.webContents, "messages:state", state);
        popup.showInactive();
    };
    (0, ipc_contract_1.onIpc)("messages:publish", (event, payload) => {
        if (event.sender !== main.webContents || !(0, messageAlertPolicy_1.isMessageAlertState)(payload)) {
            console.warn("[AINO] Rejected message notification state");
            return;
        }
        if (!payload.cards.length) {
            clear();
            return;
        }
        if (state?.cards.length !== payload.cards.length)
            measuredHeight = null;
        state = payload;
        const area = electron_1.screen.getDisplayMatching(main.getBounds()).workArea;
        const bounds = (0, messageAlertPolicy_1.messagePopupBounds)(area, payload.cards.length);
        if (measuredHeight !== null) {
            bounds.height = Math.min(area.height - 32, measuredHeight);
            bounds.y = area.y + area.height - bounds.height - 16;
        }
        if (!popup || popup.isDestroyed()) {
            ready = false;
            popup = new electron_1.BrowserWindow({
                ...bounds, frame: false, resizable: false, minimizable: false, maximizable: false,
                fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
                transparent: true, hasShadow: false, title: "AINO Messages",
                webPreferences: { preload: path_1.default.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true,
                    nodeIntegration: false, backgroundThrottling: false },
            });
            (0, navigationSecurity_1.secureWindowNavigation)(popup, apiServer, openUpload);
            const owned = popup;
            owned.on("closed", () => {
                if (popup === owned) {
                    popup = null;
                    ready = false;
                }
            });
            owned.webContents.on("render-process-gone", () => { console.error("[AINO] Notification renderer exited"); clear(); });
            void owned.loadURL("workpulse://app/message-popup").catch((error) => {
                console.error("[AINO] Notification window failed to load", error);
                clear();
            });
        }
        else
            popup.setBounds(bounds);
        publish();
    });
    (0, ipc_contract_1.onIpc)("messages:ready", (event) => {
        if (event.sender !== popup?.webContents)
            return;
        ready = true;
        publish();
    });
    (0, ipc_contract_1.onIpc)("messages:resize", (event, height) => {
        if (event.sender !== popup?.webContents || !popup || !Number.isSafeInteger(height) || height < 1 || height > 3000)
            return;
        const area = electron_1.screen.getDisplayMatching(main.getBounds()).workArea;
        const bounds = (0, messageAlertPolicy_1.messagePopupBounds)(area, state?.cards.length ?? 1);
        measuredHeight = Math.min(bounds.height, Math.max(100, height));
        bounds.height = measuredHeight;
        bounds.y = area.y + area.height - measuredHeight - 16;
        popup.setBounds(bounds);
    });
    (0, ipc_contract_1.onIpc)("messages:action", (event, action) => {
        if (event.sender !== popup?.webContents || !(0, messageAlertPolicy_1.isMessageAlertAction)(action, state)) {
            console.warn("[AINO] Rejected message notification action");
            return;
        }
        if (!main.isDestroyed())
            (0, ipc_contract_1.sendIpc)(main.webContents, "messages:action", action);
    });
    (0, ipc_contract_1.onIpc)("messages:clear", (event) => { if (event.sender === main.webContents)
        clear(); });
    main.webContents.on("render-process-gone", clear);
    main.webContents.on("did-start-loading", clear);
    main.on("closed", clear);
    electron_1.app.on("before-quit", clear);
}
//# sourceMappingURL=messageAlertWindow.js.map