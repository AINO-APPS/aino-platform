/** Pure routing logic, unit-tested outside the Worker runtime. */

export function selectOrigin(pathname, mode, origins) {
  if (mode !== "split") return origins.legacy;

  if (pathname === "/ws") return origins.realtime;
  if (pathname === "/collab" || pathname.startsWith("/collab/")) return origins.realtime;

  // Upload URLs MUST pass through the web service's tenant/org/chat
  // authorization before it returns a short-lived private R2 URL.
  if (pathname === "/uploads" || pathname.startsWith("/uploads/")) return origins.web;
  if (pathname === "/api" || pathname.startsWith("/api/")) return origins.web;
  if (pathname === "/healthz" || pathname === "/readyz") return origins.web;

  return origins.spa;
}

/**
 * Header carrying the browser-visible hostname to the origin.
 *
 * NOT `X-Forwarded-Host`: Railway's edge proxy rewrites that header with the
 * hostname it received (the `*.up.railway.app` origin), so anything the Worker
 * puts there is discarded before Express sees it. The server would then resolve
 * every console request to the tenant realm and platform login would be
 * rejected with PLATFORM_LOGIN_HOST_REQUIRED. A vendor-prefixed header is left
 * untouched by both hops.
 */
export const FORWARDED_HOST_HEADER = "X-AINO-Forwarded-Host";

/** Cloudflare Web Analytics beacon injected into SPA HTML at the edge. */
export function isCloudflareRumRequest(method, pathname) {
  return method === "POST" && pathname === "/cdn-cgi/rum";
}

export function assertOrigins(publicHost, origins, mode = "legacy") {
  const required = mode === "split"
    ? Object.entries(origins)
    : [["legacy", origins.legacy]];
  for (const [name, value] of required) {
    if (!value) throw new Error(`Missing ${name} origin`);
    const url = new URL(value);
    if (url.host === publicHost) {
      throw new Error(`${name} origin recursively points to the public Worker host`);
    }
  }
}

export function cacheHeaders(pathname) {
  if (pathname.startsWith("/assets/") || pathname.startsWith("/mediapipe/")
      || pathname.startsWith("/models/") || pathname.startsWith("/emoji/")) {
    return "public, max-age=31536000, immutable";
  }
  if (pathname === "/index.html" || pathname === "/sw.js" || pathname === "/manifest.json") {
    return "no-cache, no-store, must-revalidate";
  }
  return "no-cache";
}