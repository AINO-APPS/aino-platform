"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LISTENER_CHANNELS = exports.SEND_CHANNELS = exports.INVOKE_CHANNELS = void 0;
exports.handleIpc = handleIpc;
exports.onIpc = onIpc;
exports.sendIpc = sendIpc;
exports.INVOKE_CHANNELS = ["get-app-version", "is-maximized", "check-for-update", "fetch-release-notes", "get-ip-location", "get-native-location", "open-location-settings", "get-wifi-info", "biometric:available", "biometric:enroll", "biometric:login", "biometric:disable"];
exports.SEND_CHANNELS = ["window-minimize", "window-maximize", "window-close", "download-update", "install-update", "screen-source-selected", "flash-frame", "show-and-focus", "set-badge-count", "call:pip-open", "call:pip-close", "call:pip-update-state", "call:pip-ready", "call:pip-action"];
exports.LISTENER_CHANNELS = ["maximize-change", "update-available", "download-progress", "update-downloaded", "update-reminder", "update-not-available", "update-error", "screen-sources", "window-hidden", "window-shown", "call:pip-window-closed", "call:pip-action", "call:pip-state"];
function handleIpc(channel, listener) {
    const { ipcMain } = require("electron");
    const { assertTrustedIpcSender } = require("./ipcSecurity");
    ipcMain.handle(channel, ((event, ...args) => {
        assertTrustedIpcSender(event);
        return listener(event, ...args);
    }));
}
function onIpc(channel, listener) {
    const { ipcMain } = require("electron");
    const { assertTrustedIpcSender } = require("./ipcSecurity");
    ipcMain.on(channel, ((event, ...args) => {
        try {
            assertTrustedIpcSender(event);
        }
        catch {
            return;
        }
        listener(event, ...args);
    }));
}
function sendIpc(target, channel, ...args) { target.send(channel, ...args); }
//# sourceMappingURL=ipc-contract.js.map