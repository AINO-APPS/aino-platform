/**
 * Link-preview fetching (Signal `LinkPreviewRepository` parity).
 *
 * - Crawler User-Agents first: many sites (Google Maps / share.google, news,
 *   shops) only serve OpenGraph tags to known link-unfurl bots.
 * - Redirects are followed by hand so every hop passes the SSRF guard.
 * - The preview image is downloaded once and re-hosted in our storage, like
 *   Signal's sender-uploaded thumbnail: receivers never hotlink third parties.
 */
import crypto from "node:crypto";
import { contentMatchesType } from "../../utils/uploadPolicy";

const dns = require("dns").promises;
const net = require("net");

export interface LinkPreviewMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface LinkPreviewResult {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

export class LinkPreviewError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Order matters: bots first (they get OG tags), a browser UA last. */
export const PREVIEW_USER_AGENTS = [
  "Twitterbot/1.0",
  "WhatsApp/2",
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
];

const MAX_REDIRECTS = 5;
const HTML_LIMIT = 512 * 1024;
export const IMAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Private / loopback / link-local / CGNAT / unspecified addresses are never fetched. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:")
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast / reserved
  );
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol)) throw new LinkPreviewError(400, "Only http/https URLs supported");
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new LinkPreviewError(400, "Could not resolve host");
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new LinkPreviewError(400, "URL not allowed");
  }
}

/** GET with manual redirects; every hop is SSRF-checked. Returns the final response + URL. */
async function fetchPublic(
  start: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const response = await fetch(current.toString(), { redirect: "manual", signal, headers });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        await response.body?.cancel();
      } catch {
        /* ignore */
      }
      current = new URL(location, current);
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new LinkPreviewError(422, "Too many redirects");
}

async function readLimited(response: Response, limit: number, stopAtHeadEnd = false): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer()).subarray(0, limit);
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
      if (stopAtHeadEnd && Buffer.from(value).toString("latin1").includes("</head>")) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

/** Decode with the declared charset (Google serves ISO-8859-1), falling back to UTF-8. */
export function decodeHtml(bytes: Buffer, contentType: string): string {
  const declared =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ||
    bytes.subarray(0, 2048).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ||
    "utf-8";
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function clean(value: string | undefined, max: number): string | undefined {
  const text = value ? decodeEntities(value).replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, max) : undefined;
}

/** OpenGraph / Twitter / <title> extraction; attribute order and quote style independent. */
export function extractPreviewMeta(html: string): LinkPreviewMeta {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v && v.trim());
  const image = pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image");
  return {
    title: clean(pick("og:title", "twitter:title") || titleTag, 200),
    description: clean(pick("og:description", "twitter:description", "description"), 300),
    image: image ? decodeEntities(image).trim().slice(0, 2048) : undefined,
    siteName: clean(pick("og:site_name"), 100),
  };
}

/** Signal shows the link's own domain (e.g. `share.google`), not og:site_name. */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function hasPreview(meta: LinkPreviewMeta): boolean {
  return !!(meta.title || meta.description || meta.image);
}

/** Fetch metadata trying each crawler UA until one yields OpenGraph data. */
export async function fetchPreviewMeta(
  target: URL,
  deadline: AbortSignal,
): Promise<{ meta: LinkPreviewMeta; finalUrl: URL }> {
  let lastError: LinkPreviewError = new LinkPreviewError(422, "No preview available");
  for (const ua of PREVIEW_USER_AGENTS) {
    if (deadline.aborted) break;
    try {
      const { response, finalUrl } = await fetchPublic(
        target,
        { "User-Agent": ua, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en" },
        deadline,
      );
      const contentType = String(response.headers.get("content-type") || "");
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        lastError = new LinkPreviewError(422, "Page not reachable");
        continue;
      }
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new LinkPreviewError(422, "Not an HTML page");
      }
      const html = decodeHtml(await readLimited(response, HTML_LIMIT, true), contentType);
      const meta = extractPreviewMeta(html);
      if (hasPreview(meta)) return { meta, finalUrl };
    } catch (err) {
      if (err instanceof LinkPreviewError && err.status === 400) throw err;
      if (err instanceof LinkPreviewError && err.message === "Not an HTML page") throw err;
      if ((err as Error)?.name === "AbortError") throw err;
      lastError = err instanceof LinkPreviewError ? err : lastError;
    }
  }
  throw lastError;
}

/** Download the preview image (SSRF-checked, size/type limited). Null when unusable. */
export async function downloadPreviewImage(
  imageUrl: URL,
  deadline: AbortSignal,
): Promise<{ bytes: Buffer; mimetype: string; ext: string } | null> {
  try {
    const { response } = await fetchPublic(
      imageUrl,
      { "User-Agent": PREVIEW_USER_AGENTS[0], Accept: "image/webp,image/png,image/jpeg,image/gif" },
      deadline,
    );
    const mimetype = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[mimetype];
    const declared = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !ext || declared > IMAGE_LIMIT) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readLimited(response, IMAGE_LIMIT + 1);
    if (bytes.length > IMAGE_LIMIT || !contentMatchesType(mimetype, bytes)) return null;
    return { bytes, mimetype, ext };
  } catch {
    return null;
  }
}

export function previewCacheKey(tenantId: unknown, orgId: unknown, url: string): string {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  return `${tenantId ? `t:${tenantId}:` : ""}linkpreview:${orgId ?? "0"}:${hash}`;
}

/** Resolve the absolute image URL against the page URL after redirects. */
export function resolveImageUrl(image: string | undefined, pageUrl: URL): URL | null {
  if (!image || /^data:/i.test(image)) return null;
  try {
    const resolved = new URL(image, pageUrl);
    return /^https?:$/.test(resolved.protocol) ? resolved : null;
  } catch {
    return null;
  }
}
