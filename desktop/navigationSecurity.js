"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyWindowOpen = classifyWindowOpen;
exports.secureWindowNavigation = secureWindowNavigation;
const electron_1 = require("electron");
const protocolUtils_1 = require("./protocolUtils");
function classifyWindowOpen(url, apiServer) {
    try {
        const parsed = new URL(url);
        const pathname = decodeURIComponent(parsed.pathname);
        const ownHost = parsed.protocol === "workpulse:" && parsed.hostname === "app" || parsed.host === new URL(apiServer).host;
        if (ownHost && pathname.startsWith("/uploads/"))
            return { kind: "upload", value: pathname + parsed.search };
        if (parsed.protocol === "http:" || parsed.protocol === "https:")
            return { kind: "external", value: url };
    }
    catch { /* deny malformed URLs */ }
    return { kind: "deny" };
}
function secureWindowNavigation(window, apiServer, openUpload) {
    window.webContents.setWindowOpenHandler(({ url }) => {
        const decision = classifyWindowOpen(url, apiServer);
        if (decision.kind === "upload")
            void openUpload(decision.value).catch(err => console.error("[AINO] Failed to open uploaded file:", err?.message));
        if (decision.kind === "external")
            void electron_1.shell.openExternal(decision.value);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (!(0, protocolUtils_1.isAllowedAppNavigation)(url))
            event.preventDefault();
    });
}
//# sourceMappingURL=navigationSecurity.js.map