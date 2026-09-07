"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTrustedRendererUrl = isTrustedRendererUrl;
exports.assertTrustedIpcSender = assertTrustedIpcSender;
function isTrustedRendererUrl(url) {
    if (!url)
        return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "workpulse:" && parsed.hostname === "app";
    }
    catch {
        return false;
    }
}
function assertTrustedIpcSender(event) {
    const frameUrl = event.senderFrame?.url;
    if (!isTrustedRendererUrl(frameUrl) || event.senderFrame?.top !== event.senderFrame) {
        throw new Error("Rejected IPC from an untrusted renderer");
    }
}
//# sourceMappingURL=ipcSecurity.js.map