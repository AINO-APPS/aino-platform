"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WINDOW_STATE = void 0;
exports.parseWindowState = parseWindowState;
exports.DEFAULT_WINDOW_STATE = { width: 1280, height: 800 };
function parseWindowState(raw) {
    if (!raw)
        return exports.DEFAULT_WINDOW_STATE;
    try {
        const value = JSON.parse(raw);
        if (!Number.isFinite(value.width) || !Number.isFinite(value.height))
            return exports.DEFAULT_WINDOW_STATE;
        return value;
    }
    catch {
        return exports.DEFAULT_WINDOW_STATE;
    }
}
//# sourceMappingURL=windowState.js.map