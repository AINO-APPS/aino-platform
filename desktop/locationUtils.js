"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWindowsWifi = parseWindowsWifi;
exports.parseMacWifi = parseMacWifi;
exports.parseIpLocation = parseIpLocation;
function parseWindowsWifi(output) {
    // Newer Windows 11 builds label the associated access point as "AP BSSID"
    // while older builds use "BSSID". Accept both without accidentally matching
    // the adapter's separate "Physical address" value.
    const bssid = /^\s*(?:AP\s+)?BSSID\s*:\s*([0-9A-Fa-f:]{17})\s*$/mi.exec(output)?.[1];
    const ssid = /^\s*SSID\s*:\s*(.+?)\s*$/m.exec(output)?.[1] ?? null;
    const signal = /^\s*Signal\s*:\s*(\d+)\s*%/m.exec(output)?.[1];
    const state = /^\s*State\s*:\s*(.+?)\s*$/m.exec(output)?.[1];
    if (!bssid)
        return { ok: false, error: state && /disconnected/i.test(state) ? "wifi_disconnected" : "bssid_unavailable" };
    return { ok: true, bssid: bssid.toUpperCase(), ssid, signal: signal ? Number(signal) : null };
}
function parseMacWifi(output) {
    const bssid = /^\s*BSSID:\s*([0-9a-f:]{17})/im.exec(output)?.[1];
    const ssid = /^\s*SSID:\s*(.+)$/im.exec(output)?.[1]?.trim() ?? null;
    return bssid ? { ok: true, bssid: bssid.toUpperCase(), ssid, signal: null } : { ok: false, error: "bssid_unavailable" };
}
function parseIpLocation(value) {
    if (!value || typeof value !== "object")
        return null;
    const item = value;
    const latitude = item.status === "success" ? item.lat : item.latitude;
    const longitude = item.status === "success" ? item.lon : item.longitude;
    return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { latitude, longitude, accuracy: 5000 }
        : null;
}
//# sourceMappingURL=locationUtils.js.map