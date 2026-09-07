import {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  Menu,
  nativeImage,
  ipcMain,
  shell,
} from "electron";
// MUST be first: sets app.name/appUserModelId and migrates the legacy
// %APPDATA%\WorkPulse profile into %APPDATA%\AINO before any module reads
// app.getPath("userData") at import time (biometric.ts, callPipWindow.ts).
import "./appIdentity";
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
import { isAllowedAppNavigation } from "./protocolUtils";
import { parseWindowState, type WindowState } from "./windowState";

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
const RAILWAY_URL = process.env.API_SERVER || "https://www.aino.org.in";
// ─── Object storage (Cloudflare R2) origin ────────────────────────────────
// A3 moved every upload out of the server's filesystem and into a PRIVATE R2
// bucket. `GET /uploads/<key>` now authorizes the request and normally
// 302-redirects to a 60-second presigned URL on
// `<bucket>.<account>.r2.cloudflarestorage.com` (see
// server/http/middleware/uploads.ts). Two consequences for the desktop shell:
//   1. Current servers stream desktop requests through the authenticated upload
//      route. The proxy below also follows redirects for older server versions.
//   2. CSP evaluates the FINAL origin of a redirect chain, so the R2 host has
//      to be allowed for the case where the renderer talks to the API
//      directly (VITE_API_URL builds) instead of via the proxy.
// Wildcarded on the account subdomain rather than a bare `https:` so a
// compromised renderer still can't pull media from arbitrary hosts.
const R2_ORIGIN_PATTERN = "https://*.r2.cloudflarestorage.com";
// In packaged build, client/dist is in extraResources; in dev, it's adjacent
const CLIENT_DIST = app.isPackaged
  ? path.join(process.resourcesPath, "client", "dist")
  : path.join(__dirname, "..", "client", "dist");
const WINDOW_STATE_FILE = path.join(
  app.getPath("userData"),
  "window-state.json",
);
const VERSION_FILE = path.join(app.getPath("userData"), "last-version.txt");

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

// ─── Window state persistence ───
function loadWindowState(): WindowState {
  try {
    return parseWindowState(fs.readFileSync(WINDOW_STATE_FILE, "utf-8"));
  } catch {
    return parseWindowState(undefined);
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function saveWindowState(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const isMaximized = win.isMaximized();
    fs.writeFileSync(
      WINDOW_STATE_FILE,
      JSON.stringify({ ...bounds, isMaximized }),
    );
  }, 500);
}

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

  // Create main window
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    title: "",
    icon: nativeImage.createFromPath(
      path.join(
        __dirname,
        "icons",
        // Windows draws the taskbar/title-bar icon from this image. A
        // multi-resolution .ico lets Windows select the crisp bitmap
        // for the exact size it needs instead of runtime-downscaling a
        // single 256px PNG (which looked blurry/"cheap"). macOS/Linux
        // use the PNG (the .icns/desktop entry comes from the builder).
        process.platform === "win32" ? "icon.ico" : "icon.png",
      ),
    ),
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep timers, the WebSocket reconnect loop, and incoming
      // real-time message processing running at full speed even when
      // the window is hidden/minimized to the tray. Without this,
      // Chromium throttles hidden-window timers to ~once/minute, which
      // makes the desktop app feel "out of sync" — it only catches up
      // on live updates after you reopen it from the tray.
      backgroundThrottling: false,
    },
    show: false,
  });

  if (state.isMaximized) mainWindow.maximize();

  mainWindow.loadURL("workpulse://app/");

  // F12 toggles DevTools (only in development builds)
  if (!app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F12" && input.type === "keyDown") {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  console.log(`[AINO] API server: ${RAILWAY_URL}`);

  // Override the HTML <title> tag so the title bar stays blank
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Persist window state on move/resize
  mainWindow.on("resize", () => saveWindowState(mainWindow));
  mainWindow.on("move", () => saveWindowState(mainWindow));

  // Notify renderer of maximize state changes (for window control icons)
  mainWindow.on("maximize", () =>
    mainWindow && sendIpc(mainWindow.webContents, "maximize-change", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow && sendIpc(mainWindow.webContents, "maximize-change", false),
  );

  // ─── Notify renderer when the main window is hidden / shown ───
  // Used by the in-call overlay to auto-open the always-on-top mini PiP
  // when the user minimises or sends the app to the tray during a call,
  // and to drop back to the full overlay when the user reopens the app.
  const notifyHidden = (reason: string): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        sendIpc(mainWindow.webContents, "window-hidden", { reason });
      } catch {
        /* ignore */
      }
    }
  };
  const notifyShown = (reason: string): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        sendIpc(mainWindow.webContents, "window-shown", { reason });
      } catch {
        /* ignore */
      }
    }
  };
  mainWindow.on("minimize", () => notifyHidden("minimize"));
  mainWindow.on("hide", () => notifyHidden("hide"));
  mainWindow.on("restore", () => notifyShown("restore"));
  mainWindow.on("show", () => notifyShown("show"));
  mainWindow.on("focus", () => notifyShown("focus"));

  // Minimize to tray on close instead of quitting
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Uploaded files (documents) open behind the authenticated /uploads/*
    // route. They can't be opened directly in an external browser (no auth
    // cookies there → 403), so download them via the in-app session and
    // hand the file to the OS default app instead.
    try {
      const u = new URL(url);
      const pathname = decodeURIComponent(u.pathname);
      const isUpload = pathname.startsWith("/uploads/");
      const isOwnHost =
        url.startsWith("workpulse://") || u.host === new URL(RAILWAY_URL).host;
      if (isUpload && isOwnHost) {
        openRemoteUpload(pathname + (u.search || "")).catch((err) => {
          console.error(
            "[AINO] Failed to open uploaded file:",
            (err as Error)?.message,
          );
        });
        return { action: "deny" };
      }
    } catch {
      /* not a parseable URL — fall through */
    }

    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Prevent renderer from navigating to arbitrary origins (XSS protection)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) {
      event.preventDefault();
    }
  });

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

// macOS: re-create window when dock icon is clicked
app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Quit flag for tray close vs window close
app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
