"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDeepLink = parseDeepLink;
exports.findDeepLink = findDeepLink;
exports.showWindow = showWindow;
exports.deliverDeepLink = deliverDeepLink;
function parseDeepLink(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "workpulse:" || url.hostname !== "app")
            return null;
        const path = `${url.pathname || "/"}${url.search}${url.hash}`;
        return `workpulse://app${path.startsWith("/") ? path : `/${path}`}`;
    }
    catch {
        return null;
    }
}
function findDeepLink(argv) {
    for (const value of argv) {
        const link = parseDeepLink(value);
        if (link)
            return link;
    }
    return null;
}
function showWindow(window) {
    if (!window || window.isDestroyed())
        return;
    if (window.isMinimized())
        window.restore();
    window.show();
    window.focus();
}
function deliverDeepLink(window, value) {
    const link = parseDeepLink(value);
    if (!window || window.isDestroyed() || !link)
        return false;
    void window.loadURL(link);
    showWindow(window);
    return true;
}
//# sourceMappingURL=deepLinks.js.map