"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllowedPermission = isAllowedPermission;
exports.setupPermissions = setupPermissions;
const electron_1 = require("electron");
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "mediaKeySystem", "geolocation"]);
function isAllowedPermission(permission, requestingOrigin) {
    if (!ALLOWED_PERMISSIONS.has(permission))
        return false;
    if (!requestingOrigin)
        return false;
    try {
        const origin = new URL(requestingOrigin);
        return origin.protocol === "workpulse:" && origin.hostname === "app";
    }
    catch {
        return false;
    }
}
function setupPermissions(electronSession) {
    // Grant media + geolocation permissions.
    //   - media / display-capture / mediaKeySystem → camera, mic, screen share
    //   - geolocation → required by the "clock-in from office" geofence flow
    //                    (client/src/utils/geolocation.js → navigator.geolocation)
    // Without geolocation in this list the renderer's getCurrentPosition()
    // fires its error callback with PERMISSION_DENIED, the desktop client
    // skips sending latitude/longitude, and the server responds 403
    // "Location is required to clock in from office. Please allow location
    // access." — which looks like the user can't "enable" location even
    // though the Windows OS-level location toggle is on.
    electronSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        const granted = isAllowedPermission(permission, details.requestingUrl);
        console.log(`[AINO] Permission request: ${permission} → ${granted ? "GRANTED" : "DENIED"}`);
        callback(granted);
    });
    electronSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        const granted = isAllowedPermission(permission, requestingOrigin);
        console.log(`[AINO] Permission check: ${permission} → ${granted ? "GRANTED" : "DENIED"}`);
        return granted;
    });
    // macOS: request camera/mic access at OS level
    if (process.platform === "darwin") {
        electron_1.systemPreferences.askForMediaAccess("camera").catch(() => { });
        electron_1.systemPreferences.askForMediaAccess("microphone").catch(() => { });
    }
}
//# sourceMappingURL=permissions.js.map