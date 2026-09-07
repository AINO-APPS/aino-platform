import { net, protocol, type Session } from "electron";
import fs from "fs";
import path from "path";
import { isReadOnlyMethod, normalizeProtocolPath, resolveClientFile } from "./protocolUtils";

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

export interface ProtocolOptions { apiServer: string; clientDist: string; r2OriginPattern: string; electronSession: Session }

export function setupProtocolHandling({ apiServer, clientDist, r2OriginPattern, electronSession }: ProtocolOptions): void {
// Content Security Policy — restrict what can run in the renderer.
// NOTE: `frame-src` must allow https://embed.diagrams.net so the
// draw.io diagram editor (loaded as an <iframe> inside the notes
// editor) can render. Without it the iframe is silently blocked
// and the spinner appears to "load forever".
//
// We only apply CSP to top-level documents served by our own
// workpulse:// protocol. Sub-resources fetched by the embed
// iframe (which is on https://embed.diagrams.net) bring their
// own CSP from diagrams.net and should NOT have ours injected
// — doing so would break their script loading and make the
// editor either fail or load very slowly while it retries.
electronSession.webRequest.onHeadersReceived((details, callback) => {
  const isAppDocument =
    details.resourceType === "mainFrame" &&
    typeof details.url === "string" &&
    details.url.startsWith("workpulse://");

  if (!isAppDocument) {
    callback({ responseHeaders: details.responseHeaders });
    return;
  }

  callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": [
        "default-src 'self' workpulse://app; " +
          // 'wasm-unsafe-eval' lets MediaPipe Selfie Segmentation
          // compile its WebAssembly module (used by background
          // blur/virtual backgrounds). MediaPipe is bundled as a
          // same-origin asset under /mediapipe/ so no CDN is
          // needed in script-src/connect-src.
          "script-src 'self' workpulse://app 'unsafe-inline' 'wasm-unsafe-eval'; " +
          "style-src 'self' workpulse://app 'unsafe-inline'; " +
          // OpenStreetMap tile servers (a/b/c.tile.openstreetmap.org)
          // are needed by the Leaflet map used in Organization →
          // Attendance Settings to pick an office location. We also
          // allow unpkg.com so Leaflet's default marker icons load
          // (they're served from the npm package's CDN copy).
          `connect-src 'self' workpulse://app ${apiServer} ${r2OriginPattern} wss://${new URL(apiServer).host} https://embed.diagrams.net https://*.tile.openstreetmap.org https://nominatim.openstreetmap.org https://unpkg.com https://*.giphy.com; ` +
          // Uploads (avatars, org logos, chat images) normally arrive through
          // the same-origin `workpulse://app/uploads/...` proxy below, so
          // 'self' covers them. The API origin and the R2 origin are listed
          // as well for defence in depth: if a build ever sets VITE_API_URL,
          // the renderer resolves those <img> URLs to an absolute
          // ${apiServer}/uploads/... which then 302-redirects to a
          // presigned *.r2.cloudflarestorage.com URL — CSP evaluates the
          // FINAL origin, so both must be allowed or every avatar/logo is
          // silently blocked with a 200 in the server log.
          `img-src 'self' workpulse://app data: blob: ${apiServer} ${r2OriginPattern} https://embed.diagrams.net https://*.tile.openstreetmap.org https://unpkg.com https://*.giphy.com; ` +
          `media-src 'self' workpulse://app blob: ${apiServer} ${r2OriginPattern}; ` +
          "font-src 'self' workpulse://app; " +
          // MediaPipe spawns helper workers from blob: URLs.
          "worker-src 'self' workpulse://app blob:; " +
          // PDF/document previews render in an <iframe>, which follows the
          // same /uploads -> R2 redirect.
          `frame-src 'self' workpulse://app ${apiServer} ${r2OriginPattern} https://embed.diagrams.net; ` +
          "object-src 'none';",
      ],
    },
  });
});

// Handle the custom protocol — serve bundled React files + proxy /uploads to Railway
protocol.handle("workpulse", async (request) => {
  const url = new URL(request.url);
  const pathname = normalizeProtocolPath(url);

  // Proxy /uploads/* requests to server (cookies managed by Electron session)
  //
  // Current servers stream R2 objects for desktop custom-protocol requests.
  // Keep the two-hop path below for compatibility with older servers:
  //
  //   hop 1  ${apiServer}/uploads/<key>   -> 302 + Location: <presigned R2 URL>
  //   hop 2  <presigned R2 URL>             -> 200 + the bytes
  //
  // Hop 1 must carry our auth cookie and the `origin` / `x-requested-with`
  // pair the server's CSRF and CORS checks expect. If it redirects, hop 2
  // must carry NONE of
  // that: the bucket is private with no CORS configuration, so a request that
  // announces an `Origin` and asks for credentials is evaluated as a
  // credentialed cross-origin fetch, gets no `Access-Control-Allow-Origin`
  // back, and is rejected by Chromium *before* we ever see the bytes. That
  // rejection used to land in the catch below and be reported to the
  // renderer as a plain 404 — a broken avatar/logo with a perfectly healthy
  // 200 in the server log. Hence `redirect: "manual"` plus a deliberately
  // bare second request; a presigned URL is self-authenticating and needs
  // nothing else attached to it.
  if (pathname.startsWith("/uploads/") || pathname.startsWith("/uploads\\")) {
    const startedAt = Date.now();
    try {
      // Only forward the few request headers the upload path actually needs.
      // Blindly copying every header (the previous behaviour) leaked
      // renderer-specific headers such as `sec-fetch-*` onto the R2 hop.
      const headers: Record<string, string> = {
        origin: "workpulse://app",
        "x-requested-with": "WorkPulse",
      };
      const accept = request.headers.get("accept");
      if (accept) headers["accept"] = accept;
      // <video>/<audio> attachments seek with byte ranges; pass them through
      // on both hops so scrubbing keeps working.
      const range = request.headers.get("range");
      if (range) headers["range"] = range;

      let resp = await net.fetch(
        `${apiServer}${pathname}${url.search || ""}`,
        {
          method: request.method,
          headers,
          credentials: "include",
          redirect: "manual",
          bypassCustomProtocolHandlers: true,
        },
      );

      let followed = false;
      const location = resp.headers.get("location");
      if (resp.status >= 300 && resp.status < 400 && location) {
        followed = true;
        const signedHeaders: Record<string, string> = {};
        if (range) signedHeaders["range"] = range;
        resp = await net.fetch(location, {
          method: request.method,
          headers: signedHeaders,
          // No cookies, no Origin: the signature IS the credential, and
          // anything extra turns this into a blocked CORS request.
          credentials: "omit",
          bypassCustomProtocolHandlers: true,
        });
      } else if (resp.type === "opaqueredirect" || resp.status === 0) {
        // Per the Fetch spec, `redirect: "manual"` may surface the 302 as an
        // OPAQUE redirect: status 0, no readable headers, no Location. We
        // then can't drive the second hop ourselves, so repeat hop 1 and let
        // the network stack follow the chain. The important part — not
        // handing a *redirected* Response straight back to protocol.handle,
        // which Chromium rejects — is preserved by the re-wrap below.
        followed = true;
        resp = await net.fetch(
          `${apiServer}${pathname}${url.search || ""}`,
          {
            method: request.method,
            headers,
            credentials: "include",
            redirect: "follow",
            bypassCustomProtocolHandlers: true,
          },
        );
      }

      console.log(
        `[proxy] ${request.method} ${pathname} -> ${resp.status}` +
          `${followed ? " (via R2 redirect)" : ""} (${Date.now() - startedAt}ms)`,
      );

      if (!resp.ok && resp.status !== 206) {
        return new Response("File not found", { status: resp.status });
      }

      // Re-wrap the body so R2's CORS/auth headers never reach the renderer,
      // and so the response is attributed to the workpulse:// origin.
      const body = await resp.arrayBuffer();
      const outHeaders: Record<string, string> = {
        "Content-Type":
          resp.headers.get("content-type") || getMimeType(pathname),
        // Uploads are immutable (filenames embed a timestamp), but the URL we
        // proxy through is per-user authorized, so keep it out of any shared
        // cache while still letting the renderer reuse it. This is what stops
        // every avatar re-render from costing two network round-trips.
        "Cache-Control": "private, max-age=3600",
        "Accept-Ranges": resp.headers.get("accept-ranges") || "bytes",
      };
      const contentRange = resp.headers.get("content-range");
      if (contentRange) outHeaders["Content-Range"] = contentRange;

      return new Response(body, { status: resp.status, headers: outHeaders });
    } catch (err) {
      console.error(
        `[proxy] UPLOAD FETCH ERROR ${pathname}:`,
        (err as Error)?.message,
      );
      return new Response("File not found", { status: 404 });
    }
  }

  // Proxy /api/* requests to server (cookies managed by Electron session)
  if (pathname.startsWith("/api/") || pathname.startsWith("/api\\")) {
    const targetUrl = `${apiServer}${pathname}${url.search || ""}`;
    try {
      const headers: Record<string, string> = {};
      // Copy all incoming headers into a plain object
      for (const [key, value] of request.headers.entries()) {
        if (key.toLowerCase() === "host") continue; // skip host
        headers[key] = value;
      }
      headers["origin"] = "workpulse://app";
      headers["x-requested-with"] = "WorkPulse";

      // `cache: "no-store"` on EVERY request defeated HTTP caching for
      // read-only GETs (chat messages, members, read-status, presence),
      // forcing a full remote round-trip each time and adding latency on
      // the chat-open path. Mutating requests still bypass the cache.
      const isReadOnly = isReadOnlyMethod(request.method);
      const fetchOpts: RequestInit & {
        bypassCustomProtocolHandlers?: boolean;
      } = {
        method: request.method,
        headers,
        credentials: "include",
        cache: isReadOnly ? "default" : "no-store",
        bypassCustomProtocolHandlers: true,
      };

      // Buffer the body for methods that have one
      if (!["GET", "HEAD"].includes(request.method)) {
        try {
          const buf = await request.arrayBuffer();
          if (buf.byteLength > 0) {
            fetchOpts.body = Buffer.from(buf);
          }
        } catch {
          /* no body */
        }
      }

      // Timing is logged so the real remote round-trip cost is measurable
      // when diagnosing slow screens (the chat open path in particular).
      const startedAt = Date.now();
      const resp = await net.fetch(targetUrl, fetchOpts);
      console.log(
        `[proxy] ${request.method} ${targetUrl} -> ${resp.status} (${
          Date.now() - startedAt
        }ms)`,
      );
      return resp;
    } catch (err) {
      console.error("[proxy] FETCH ERROR:", err);
      return new Response(JSON.stringify({ error: "Desktop proxy error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Serve static files from client/dist
  const filePath = resolveClientFile(clientDist, pathname);
  if (!filePath) {
    return new Response("Forbidden", { status: 403 });
  }

  // Serve file if it exists, otherwise SPA fallback to index.html
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile()) {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        headers: { "Content-Type": getMimeType(filePath) },
      });
    }
  } catch {
    /* file doesn't exist — fall through to SPA fallback */
  }

  // SPA fallback — serve index.html for all non-file routes
  const indexPath = path.join(clientDist, "index.html");
  try {
    const data = await fs.promises.readFile(indexPath);
    return new Response(data, {
      headers: { "Content-Type": "text/html" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});
}
