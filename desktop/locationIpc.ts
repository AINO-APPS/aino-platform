import { net, shell } from "electron";
import { execFile } from "child_process";
import util from "util";
import { handleIpc } from "./ipc-contract";

const execFileP = util.promisify(execFile);

export function setupLocationIpc(): void {
// ─── IP-based geolocation fallback ─────────────────────────────────
// Chromium's navigator.geolocation in Electron always routes through
// Google's Geolocation API and requires a GOOGLE_API_KEY to actually
// resolve a fix. When no key is configured (the default for our
// packaged desktop app), every getCurrentPosition() call fails with
// POSITION_UNAVAILABLE → the user sees
//    "Couldn't determine your location. Check your GPS / Wi-Fi …"
// and is blocked from clocking in.
//
// To unblock those users we expose a renderer-callable IPC
// (`get-ip-location`) that asks a free IP-geolocation service
// (ip-api.com) for an approximate {latitude, longitude, accuracy}.
// The renderer's geolocation util uses this as a last-resort
// fallback only when navigator.geolocation has already failed.
//
// Caveats (documented in the renderer): IP-based geolocation is
// typically city-level accurate (a few km), can be wildly off when
// the user is on a corporate VPN, and counts as "best effort". The
// accuracy value returned reflects this so the server-side geofence
// radius is the real source of truth.
// ─── Wi-Fi BSSID reader (Stage 7: Wi-Fi-first attendance) ──────────
// Returns `{ ok, bssid, ssid, signal }` describing the access point the
// OS is currently associated with. The attendance clock-in flow sends
// the BSSID alongside the geolocation; the server prefers BSSID match
// (against the org's allow-list) over geofence, which works around the
// inaccurate IP-based geolocation we get on packaged Electron builds.
//
// Privacy: we never persist any of this in the desktop app — the
// renderer reads it on demand at clock-in time only. BSSID lookup
// requires Windows Location Services to be ON; without it `netsh`
// returns `(blank)` for the BSSID and we surface `{ ok: false }`.
handleIpc("get-wifi-info", async () => {
  console.log("[AINO] get-wifi-info: reading Wi-Fi interface...");
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileP("netsh", [
        "wlan",
        "show",
        "interfaces",
      ]);
      console.log(
        "[AINO] get-wifi-info: netsh output length =",
        stdout.length,
      );
      const bssidM = /^\s*BSSID\s*:\s*([0-9A-Fa-f:]{17})\s*$/m.exec(stdout);
      const ssidM = /^\s*SSID\s*:\s*(.+?)\s*$/m.exec(stdout);
      const sigM = /^\s*Signal\s*:\s*(\d+)\s*%/m.exec(stdout);
      const stateM = /^\s*State\s*:\s*(.+?)\s*$/m.exec(stdout);
      console.log("[AINO] get-wifi-info: parsed →", {
        bssid: bssidM?.[1] || null,
        ssid: ssidM?.[1] || null,
        signal: sigM?.[1] || null,
        state: stateM?.[1] || null,
      });
      if (!bssidM) {
        const error =
          stateM && /disconnected/i.test(stateM[1])
            ? "wifi_disconnected"
            : "bssid_unavailable";
        console.warn("[AINO] get-wifi-info: no BSSID →", error);
        return { ok: false, error };
      }
      const result = {
        ok: true,
        bssid: bssidM[1].toUpperCase(),
        ssid: ssidM ? ssidM[1] : null,
        signal: sigM ? Number(sigM[1]) : null,
      };
      console.log("[AINO] get-wifi-info: success →", result);
      return result;
    }
    if (process.platform === "darwin") {
      const airport =
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      const { stdout } = await execFileP(airport, ["-I"]);
      const bssidM = /\bBSSID:\s*([0-9a-fA-F:]{11,17})/.exec(stdout);
      const ssidM = /\bSSID:\s*(.+)/.exec(stdout);
      const rssiM = /\bagrCtlRSSI:\s*(-?\d+)/.exec(stdout);
      if (!bssidM) return { ok: false, error: "bssid_unavailable" };
      // Pad single-digit hex octets — macOS reports `1:2:3:4:5:6`.
      const padded = bssidM[1]
        .split(":")
        .map((s) => s.padStart(2, "0"))
        .join(":")
        .toUpperCase();
      return {
        ok: true,
        bssid: padded,
        ssid: ssidM ? ssidM[1].trim() : null,
        signal: rssiM ? Number(rssiM[1]) : null,
      };
    }
    if (process.platform === "linux") {
      try {
        const { stdout: bssidOut } = await execFileP("iwgetid", ["-ra"]);
        const bssid = bssidOut.trim().toUpperCase();
        if (!bssid) return { ok: false, error: "bssid_unavailable" };
        let ssid: string | null = null;
        try {
          const { stdout: ssidOut } = await execFileP("iwgetid", ["-r"]);
          ssid = ssidOut.trim() || null;
        } catch {
          /* ignore */
        }
        return { ok: true, bssid, ssid, signal: null };
      } catch {
        return { ok: false, error: "iwgetid_missing" };
      }
    }
    return { ok: false, error: "unsupported_platform" };
  } catch (err) {
    console.warn("[AINO] get-wifi-info failed:", (err as Error)?.message);
    return {
      ok: false,
      error: (err as Error)?.message || "wifi_lookup_failed",
    };
  }
});

// ─── Native Windows geolocation via .NET Location API ──────────────
// Bypasses Chromium entirely and uses the OS location service (GPS /
// Wi-Fi triangulation). Much more accurate than IP-based geolocation.
handleIpc("get-native-location", async () => {
  if (process.platform !== "win32") {
    return { ok: false, error: "unsupported_platform" };
  }
  console.log("[AINO] get-native-location: querying Windows Location API...");
  try {
    const script = `
Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
$w.Start()
$timeout = [DateTime]::Now.AddSeconds(15)
while ($w.Status -ne 'Ready' -and [DateTime]::Now -lt $timeout) { Start-Sleep -Milliseconds 250 }
if ($w.Status -eq 'Ready') {
  $p = $w.Position.Location
  if ($p.Latitude -ne [Double]::NaN) {
      Write-Output "$($p.Latitude)|$($p.Longitude)|$($p.HorizontalAccuracy)"
  } else { Write-Output "ERROR|NoFix" }
} else { Write-Output "ERROR|$($w.Status)" }
$w.Stop()
`.trim();
    const { stdout } = await execFileP(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 20000 },
    );
    const line = stdout.trim();
    console.log("[AINO] get-native-location: raw output:", line);
    if (line.startsWith("ERROR|")) {
      const reason = line.split("|")[1] || "unknown";
      console.warn("[AINO] get-native-location: failed →", reason);
      return { ok: false, error: reason };
    }
    const parts = line.split("|");
    const latitude = parseFloat(parts[0]);
    const longitude = parseFloat(parts[1]);
    const accuracy = parseFloat(parts[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn("[AINO] get-native-location: parse failed →", line);
      return { ok: false, error: "parse_failed" };
    }
    const result = {
      ok: true,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? accuracy : 100,
    };
    console.log("[AINO] get-native-location: success →", result);
    return result;
  } catch (err) {
    console.warn(
      "[AINO] get-native-location failed:",
      (err as Error)?.message,
    );
    return {
      ok: false,
      error: (err as Error)?.message || "native_location_failed",
    };
  }
});

// ─── Open OS-level Location settings ─────────────────────────────────
// The renderer surfaces this as a "Open Windows Location Settings" button
// when a clock-in fails because the geolocation fix is too coarse — the
// root cause is almost always that the user has Windows Location Services
// turned off, which is a fix the user has to make themselves in Settings.
handleIpc("open-location-settings", async () => {
  try {
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:privacy-location");
      return { ok: true };
    }
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices",
      );
      return { ok: true };
    }
    // Linux desktops don't have a unified privacy-location URI;
    // just open a help URL so the user can find the right toggle.
    await shell.openExternal(
      "https://www.google.com/search?q=enable+location+services+linux",
    );
    return { ok: true };
  } catch (err) {
    console.warn(
      "[AINO] open-location-settings failed:",
      (err as Error)?.message,
    );
    return { ok: false, error: (err as Error)?.message || "open_failed" };
  }
});

handleIpc("get-ip-location", async () => {
  console.log("[AINO] get-ip-location: attempting IP geolocation...");
  // Try a couple of providers for resilience; both are free / no key.
  const providers: {
    url: string;
    parse: (
      j: any,
    ) => { latitude: number; longitude: number; accuracy: number } | null;
  }[] = [
    {
      url: "http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,query",
      parse: (j) =>
        j && j.status === "success"
          ? { latitude: j.lat, longitude: j.lon, accuracy: 5000 }
          : null,
    },
    {
      url: "https://ipapi.co/json/",
      parse: (j) =>
        j && typeof j.latitude === "number" && typeof j.longitude === "number"
          ? { latitude: j.latitude, longitude: j.longitude, accuracy: 5000 }
          : null,
    },
  ];
  for (const p of providers) {
    try {
      console.log(`[AINO] get-ip-location: trying ${p.url}...`);
      const resp = await net.fetch(p.url, { method: "GET" });
      console.log(
        `[AINO] get-ip-location: ${p.url} responded ${resp.status}`,
      );
      if (!resp.ok) continue;
      const json = await resp.json();
      console.log(
        `[AINO] get-ip-location: ${p.url} body:`,
        JSON.stringify(json),
      );
      const coords = p.parse(json);
      if (coords) {
        console.log(
          `[AINO] IP geolocation via ${p.url} → ${coords.latitude},${coords.longitude}`,
        );
        return { ok: true, ...coords };
      }
      console.warn(
        `[AINO] get-ip-location: ${p.url} returned data but parse failed`,
      );
    } catch (err) {
      console.warn(
        `[AINO] IP geolocation provider failed (${p.url}):`,
        (err as Error)?.message,
      );
    }
  }
  console.error("[AINO] get-ip-location: ALL providers failed");
  return { ok: false, error: "All IP geolocation providers failed" };
});

}
