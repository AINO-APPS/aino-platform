import path from "path";

export function normalizeProtocolPath(url: URL): string {
  const decoded = decodeURIComponent(url.pathname || "/").replace(/\\/g, "/");
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

export function resolveClientFile(clientDist: string, pathname: string): string | null {
  const root = path.resolve(clientDist);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

export function isAllowedAppNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "workpulse:" && parsed.hostname === "app";
  } catch {
    return false;
  }
}

export function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}