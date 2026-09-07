import {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  Menu,
  shell,
} from "electron";
// MUST be first: sets app.name/appUserModelId and migrates the legacy
// %APPDATA%\WorkPulse profile into %APPDATA%\AINO before any module reads
// app.getPath("userData") at import time (biometric.ts, callPipWindow.ts).

import path from "path";
import fs from "fs";
import os from "os";
import { setupTray } from "./tray";
import { setupUpdater } from "./updater";
import { setupCallPipWindow } from "./callPipWindow";
import { setupBiometric } from "./biometric";
import { handleIpc, onIpc, sendIpc } from "./ipc-contract";
import { setupPermissions } from "./permissions";
import { setupScreenCapture } from "./screenCapture";
import { setupLocationIpc } from "./locationIpc";
import { setupProtocolHandling } from "./protocol";

import { setupLifecycle } from "./lifecycle";
import { createMainWindow } from "./windows";

import { createDesktopConfig, R2_ORIGIN_PATTERN } from "./config";

// App identity (appUserModelId + app.name) and the legacy userData migration
// now live in ./appIdentity, imported at the very top so they run before any
// module resolves app.getPath("userData").

// ─── Chromium geolocation API key ─────────────────────────────────────────
// Chromium's network-based geolocation (used by navigator.geolocation when
// the renderer can't reach the OS location service) calls Google's
// Geolocation API and **requires** an API key. Without one, every call
// fails with POSITION_UNAVAILABLE, which surfaces in the UI as
// "Location is required to clock in from office. Please allow location
// access." even after the user clicks "Allow".
//
// We expose two ways to supply the key:
//   1. Set GOOGLE_API_KEY in the environment (or in your shell before
//      launching the packaged app).
//   2. Drop a `google-api-key.txt` file next to main.js (dev) or in
//      resources/ (packaged) containing only the raw key string.
//
// If neither is provided, Chromium will fall back to whatever the OS
// location service returns (Windows 10/11 ships one when the user has
// "Location" turned on in Windows Settings → Privacy → Location), but
// in most office environments that still works because Wi-Fi based
// positioning is available.
// Track the api key we actually loaded so the post-ready startup probe can
// independently verify with Google that the key is accepted. We deliberately
// don't print the full key anywhere, only its length and first 4 chars, so
// the desktop log can be shared without leaking the secret.
let LOADED_GOOGLE_API_KEY = "";

(() => {
  let apiKey = process.env.GOOGLE_API_KEY || "";
  console.log(
    "[AINO] GOOGLE_API_KEY from env:",
    apiKey ? `set (${apiKey.length} chars)` : "not set",
  );
  if (!apiKey) {
    const candidates = [
      path.join(__dirname, "google-api-key.txt"),
      app.isPackaged
        ? path.join(process.resourcesPath, "google-api-key.txt")
        : null,
    ].filter(Boolean) as string[];
    console.log("[AINO] Checking API key file candidates:", candidates);
    for (const f of candidates) {
      try {
        if (fs.existsSync(f)) {
          const raw = fs.readFileSync(f, "utf-8");
          // .trim() strips trailing \n / \r\n that `echo > file` adds.
          // We log both the raw and trimmed lengths so a future CI
          // regression that re-introduces a stray newline is visible.
          apiKey = raw.trim();
          console.log(
            `[AINO] Found API key in ${f} ` +
              `(raw=${raw.length} bytes, trimmed=${apiKey.length} chars, ` +
              `prefix='${apiKey.slice(0, 4)}…')`,
          );
          if (apiKey) break;
        } else {
          console.log(`[AINO] File not found: ${f}`);
        }
      } catch (err) {
        console.warn(`[AINO] Error reading ${f}:`, (err as Error)?.message);
      }
    }
  }
  if (apiKey) {
    app.commandLine.appendSwitch("google-api-key", apiKey);
    process.env.GOOGLE_API_KEY = apiKey;
    LOADED_GOOGLE_API_KEY = apiKey;
    // Confirm Chromium actually accepted the switch — `appendSwitch` is
    // silent on validation errors, but `getSwitchValue` round-trips so
    // we can verify the value is in the command line as expected.
    const registered = app.commandLine.getSwitchValue("google-api-key");
    console.log(
      `[AINO] Geolocation API key configured ` +
        `(switch length=${registered.length}, matches=${registered === apiKey})`,
    );
  } else {
    console.log(
      "[AINO] No GOOGLE_API_KEY found — relying on OS location service for geolocation",
    );
  }
})();

// Safety net: log uncaught errors instead of letting Electron show the
// fatal "A JavaScript error occurred in the main process" dialog and exit.
process.on("uncaughtException", (err) => {
  console.error("[AINO] Uncaught exception in main process:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[AINO] Unhandled promise rejection in main process:", reason);
});

// ─── Configuration ───
// Production backend origin. Must be the `www.` host: the apex `aino.org.in`
// is a registrar redirect and is NOT served by Railway (it 404s on /api). The
// legacy `workpulse-prod.up.railway.app` origin still resolves to the same
// server and must stay alive for already-installed builds that baked it in.
const config = createDesktopConfig({ apiServer: process.env.API_SERVER, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, dirname: __dirname, userData: app.getPath("userData") });
const RAILWAY_URL = config.apiServer;
const CLIENT_DIST = config.clientDist;
const WINDOW_STATE_FILE = config.windowStateFile;
const VERSION_FILE = config.versionFile;

// ─── Cache clearing on version change ───
function clearCacheIfVersionChanged(): boolean {
  const currentVersion = app.getVersion();
  let lastVersion: string | null = null;
  try {
    lastVersion = fs.readFileSync(VERSION_FILE, "utf-8").trim();
  } catch {
    /* first run or missing file */
  }
  if (lastVersion !== currentVersion) {
    console.log(
      `[AINO] Version changed: ${lastVersion || "none"} → ${currentVersion}, will clear cache`,
    );
    // Write new version immediately so we don't repeat on crash
    try {
      fs.writeFileSync(VERSION_FILE, currentVersion);
    } catch {
      /* ignore */
    }
    return true; // Signal that cache should be cleared after session is ready
  }
  return false;
}

const shouldClearCache = clearCacheIfVersionChanged();

// ─── Open an uploaded file (document) in the OS default app ───
// Uploaded files live behind the authenticated `/uploads/*` route, so they
// can only be fetched with the Electron session's auth cookies — an external
// browser would get a 403. We therefore download the file through the same
// authenticated session the in-app proxy uses, write it to a temp file, and
// hand it to the OS to open with the user's default application.
async function openRemoteUpload(
  pathWithQuery: string,
  suggestedName?: string,
): Promise<void> {
  const resp = await net.fetch(`${RAILWAY_URL}${pathWithQuery}`, {
    method: "GET",
    headers: {
      origin: "workpulse://app",
      "x-requested-with": "WorkPulse",
    },
    credentials: "include",
    bypassCustomProtocolHandlers: true,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const rawName =
    suggestedName || path.basename(pathWithQuery.split("?")[0]) || "download";
  // Strip anything unsafe for a filename; keep the extension so the OS picks
  // the right default app.
  const safeName =
    rawName.replace(/[^\w.\- ]+/g, "_").slice(-120) || "download";
  const tmpPath = path.join(os.tmpdir(), `workpulse-${Date.now()}-${safeName}`);
  await fs.promises.writeFile(tmpPath, buf);

  const err = await shell.openPath(tmpPath);
  if (err) throw new Error(err);
}

// ─── Custom protocol registration (must happen before app.ready) ───
// REBRAND NOTE (WorkPulse -> AINO): the `workpulse` scheme is INTENTIONALLY
// not renamed. It is an internal transport the user never sees -- it appears
// in no UI, only in the CSP header, the session cookie partition key and the
// origin sent to the API. Renaming it would invalidate the existing Chromium
// cookie partition (logging everyone out) for zero branding benefit. The
// server already accepts `aino://` alongside it, so this can be flipped later
// as an isolated, deliberate change.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "workpulse",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: false,
    },
  },
]);

// ─── MIME type lookup ───
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ─── Main ───
let mainWindow: BrowserWindow | null = null;
let tray: Electron.Tray | null = null;

app.whenReady().then(async () => {
  // Clear stale caches from previous version
  if (shouldClearCache) {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ["cachestorage", "serviceworkers"],
      });
      console.log("[AINO] Cleared cache after version update");
    } catch (err) {
      console.error("[AINO] Cache clear failed:", (err as Error)?.message);
    }
  }

  setupPermissions(session.defaultSession);

  setupScreenCapture(session.defaultSession, () => mainWindow);
  setupLocationIpc();
  setupProtocolHandling({ apiServer: RAILWAY_URL, clientDist: CLIENT_DIST, r2OriginPattern: R2_ORIGIN_PATTERN, electronSession: session.defaultSession });

  // Remove default menu bar
  Menu.setApplicationMenu(null);

  mainWindow = createMainWindow({ dirname: __dirname, stateFile: WINDOW_STATE_FILE, apiServer: RAILWAY_URL, openUpload: openRemoteUpload });

  // System tray
  tray = setupTray(mainWindow);

  // Auto-updater
  setupUpdater(mainWindow);

  // Always-on-top mini call window (Teams-style "floatie") — opens via
  // IPC from the renderer when the user clicks the in-call PiP button.
  setupCallPipWindow(mainWindow);

  // Desktop biometric login (Windows Hello / Touch ID) — registers the
  // biometric:* IPC handlers used by the renderer's AuthContext.
  setupBiometric(() => mainWindow);

  // ─── One-time startup probe of Google Geolocation API ──────────────
  // Chromium's navigator.geolocation calls into this same endpoint, but
  // silently swallows any HTTP error and falls back to a *very* coarse
  // built-in fix. That makes "the key isn't working" indistinguishable
  // from "the user is in a poor-signal area" in user-facing symptoms.
  //
  // To convert that silent failure into a loud one, we explicitly hit
  // the endpoint at startup with the same key. The result is logged
  // (lat/lng truncated to 2 decimals so we don't leak the user's exact
  // location into shareable logs) so you can tell at a glance from the
  // desktop log whether the key is accepted by Google:
  //
  //   OK     → "GeoProbe: Google accepted key, accuracy ≈ X m at LAT,LNG"
  //   FAIL   → "GeoProbe: HTTP 403 — REQUEST_DENIED — API has not been
  //             used in project ..."
  //
  // Cost: 1 Geolocation API request per app start (~$0.005). Negligible.
  if (LOADED_GOOGLE_API_KEY) {
    (async () => {
      try {
        const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(LOADED_GOOGLE_API_KEY)}`;
        const resp = await net.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ considerIp: true }),
        });
        const body = await resp.text();
        if (!resp.ok) {
          console.warn(
            `[AINO] GeoProbe: Google rejected the API key — HTTP ${resp.status}: ${body.slice(0, 500)}`,
          );
          return;
        }
        let parsed: {
          location?: { lat: number; lng: number };
          accuracy?: number;
        } | null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        if (parsed && parsed.location) {
          const lat = Number(parsed.location.lat).toFixed(2);
          const lng = Number(parsed.location.lng).toFixed(2);
          console.log(
            `[AINO] GeoProbe: Google accepted key, accuracy ≈ ${parsed.accuracy} m at ${lat},${lng} (IP-only, Chromium will do better with Wi-Fi scan)`,
          );
        } else {
          console.warn(
            "[AINO] GeoProbe: unexpected response shape:",
            body.slice(0, 500),
          );
        }
      } catch (err) {
        console.warn(
          "[AINO] GeoProbe: failed to reach Google Geolocation API:",
          (err as Error)?.message,
        );
      }
    })();
  } else {
    console.log("[AINO] GeoProbe: skipped (no GOOGLE_API_KEY loaded)");
  }
});

setupLifecycle(app, () => mainWindow);


