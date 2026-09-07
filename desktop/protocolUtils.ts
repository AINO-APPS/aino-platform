import path from "path";

export function normalizeProtocolPath(url: URL): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname || "/");
  } catch {
    decoded = url.pathname || "/";
  }
  decoded = decoded.replace(/\\/g, "/");
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

export function shouldApplyAppCsp(url: string, resourceType: string): boolean {
  return resourceType === "mainFrame" && isAllowedAppNavigation(url);
}

export function createProxyRequest(apiServer: string, request: Request): { url: string; init: RequestInit & { bypassCustomProtocolHandlers: boolean } } {
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