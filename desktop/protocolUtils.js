"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProtocolPath = normalizeProtocolPath;
exports.resolveClientFile = resolveClientFile;
exports.isAllowedAppNavigation = isAllowedAppNavigation;
exports.isReadOnlyMethod = isReadOnlyMethod;
exports.shouldApplyAppCsp = shouldApplyAppCsp;
exports.createProxyRequest = createProxyRequest;
const path_1 = __importDefault(require("path"));
function normalizeProtocolPath(url) {
    let decoded;
    try {
        decoded = decodeURIComponent(url.pathname || "/");
    }
    catch {
        decoded = url.pathname || "/";
    }
    decoded = decoded.replace(/\\/g, "/");
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
function shouldApplyAppCsp(url, resourceType) {
    return resourceType === "mainFrame" && isAllowedAppNavigation(url);
}
function createProxyRequest(apiServer, request) {
    const source = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("origin", "workpulse://app");
    headers.set("x-requested-with", "WorkPulse");
    return {
        url: `${apiServer}${normalizeProtocolPath(source)}${source.search}`,
        init: {
            method: request.method,
            headers,
            credentials: "include",
            cache: isReadOnlyMethod(request.method) ? "default" : "no-store",
            bypassCustomProtocolHandlers: true,
        },
    };
}
//# sourceMappingURL=protocolUtils.js.map