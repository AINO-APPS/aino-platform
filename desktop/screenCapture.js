"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupScreenCapture = setupScreenCapture;
const electron_1 = require("electron");
const ipc_contract_1 = require("./ipc-contract");
function setupScreenCapture(electronSession, getWindow) {
    // ─── Screen sharing: show picker so user can choose which screen/window ───
    let pendingSourceSelection = null;
    // Safely invoke the displayMedia callback. Recent Electron versions throw
    // "Video was requested, but no video stream was provided" if you call
    // callback({}) to cancel — wrap in try/catch so a user cancel doesn't
    // crash the main process.
    const safeInvokeCallback = (callback, streams) => {
        try {
            callback(streams);
        }
        catch (err) {
            console.warn("[AINO] displayMedia callback error (likely user cancel):", err?.message);
        }
    };
    electronSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
            const sources = await electron_1.desktopCapturer.getSources({
                types: ["screen", "window"],
                thumbnailSize: { width: 320, height: 180 },
                fetchWindowIcons: true,
            });
            // Send source list to renderer for user selection
            const serialized = sources.map((s) => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail.toDataURL(),
                appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
            }));
            getWindow() && (0, ipc_contract_1.sendIpc)(getWindow().webContents, "screen-sources", serialized);
            // Wait for user to pick a source or cancel
            pendingSourceSelection = { sources, callback };
        }
        catch {
            safeInvokeCallback(callback, {});
        }
    });
    (0, ipc_contract_1.onIpc)("screen-source-selected", (_e, sourceId) => {
        if (!pendingSourceSelection)
            return;
        const { sources, callback } = pendingSourceSelection;
        pendingSourceSelection = null;
        if (!sourceId) {
            safeInvokeCallback(callback, {}); // user cancelled
            return;
        }
        const selected = sources.find((s) => s.id === sourceId);
        if (selected) {
            safeInvokeCallback(callback, { video: selected, audio: "loopback" });
        }
        else {
            safeInvokeCallback(callback, {});
        }
    });
}
//# sourceMappingURL=screenCapture.js.map