"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupLifecycle = setupLifecycle;
const deepLinks_1 = require("./deepLinks");
function setupLifecycle(app, getWindow) {
    app.on("activate", () => (0, deepLinks_1.showWindow)(getWindow()));
    app.on("open-url", (event, url) => {
        event.preventDefault();
        (0, deepLinks_1.deliverDeepLink)(getWindow(), url);
    });
    if (app.isPackaged)
        app.setAsDefaultProtocolClient("workpulse");
    const hasLock = app.requestSingleInstanceLock();
    if (!hasLock) {
        app.quit();
        return false;
    }
    app.on("second-instance", (_event, argv) => {
        const window = getWindow();
        const link = (0, deepLinks_1.findDeepLink)(argv);
        if (!link || !(0, deepLinks_1.deliverDeepLink)(window, link))
            (0, deepLinks_1.showWindow)(window);
    });
    app.on("before-quit", () => { app.isQuitting = true; });
    app.on("window-all-closed", () => { if (process.platform !== "darwin")
        app.quit(); });
    return true;
}
//# sourceMappingURL=lifecycle.js.map