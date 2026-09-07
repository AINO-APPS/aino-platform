"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProtocolPath = normalizeProtocolPath;
exports.resolveClientFile = resolveClientFile;
exports.isAllowedAppNavigation = isAllowedAppNavigation;
exports.isReadOnlyMethod = isReadOnlyMethod;
const path_1 = __importDefault(require("path"));
function normalizeProtocolPath(url) {
    const decoded = decodeURIComponent(url.pathname || "/").replace(/\\/g, "/");
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
}
function resolveClientFile(clientDist, pathname) {
    const root = path_1.default.resolve(clientDist);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = path_1.default.resolve(root, relative);
    return candidate === root || candidate.startsWith(`${root}${path_1.default.sep}`) ? candidate : null;
}
function isAllowedAppNavigation(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "workpulse:" && parsed.hostname === "app";
    }
    catch {
        return false;
    }
}
function isReadOnlyMethod(method) {
    return method === "GET" || method === "HEAD";
}
//# sourceMappingURL=protocolUtils.js.map