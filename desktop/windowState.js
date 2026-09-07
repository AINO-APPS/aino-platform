"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WINDOW_STATE = void 0;
exports.parseWindowState = parseWindowState;
exports.loadWindowState = loadWindowState;
exports.createWindowStateSaver = createWindowStateSaver;
const fs_1 = __importDefault(require("fs"));
exports.DEFAULT_WINDOW_STATE = { width: 1280, height: 800 };
function parseWindowState(raw) {
    if (!raw)
        return exports.DEFAULT_WINDOW_STATE;
    try {
        const value = JSON.parse(raw);
        if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width < 800 || value.height < 600)
            return exports.DEFAULT_WINDOW_STATE;
        if (value.x !== undefined && !Number.isFinite(value.x))
            return exports.DEFAULT_WINDOW_STATE;
        if (value.y !== undefined && !Number.isFinite(value.y))
            return exports.DEFAULT_WINDOW_STATE;
        return { width: value.width, height: value.height, ...(value.x === undefined ? {} : { x: value.x }), ...(value.y === undefined ? {} : { y: value.y }), ...(typeof value.isMaximized === "boolean" ? { isMaximized: value.isMaximized } : {}) };
    }
    catch {
        return exports.DEFAULT_WINDOW_STATE;
    }
}
function loadWindowState(file) {
    try {
        return parseWindowState(fs_1.default.readFileSync(file, "utf8"));
    }
    catch {
        return exports.DEFAULT_WINDOW_STATE;
    }
}
function createWindowStateSaver(file, delay = 500) {
    let timer;
    return (window) => {
        if (!window || window.isDestroyed())
            return;
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            if (!window || window.isDestroyed())
                return;
            fs_1.default.writeFileSync(file, JSON.stringify({ ...window.getBounds(), isMaximized: window.isMaximized() }));
        }, delay);
    };
}
//# sourceMappingURL=windowState.js.map