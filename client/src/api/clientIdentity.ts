export const webBuildVersion = import.meta.env.VITE_WEB_BUILD_VERSION;
export const apiBaseURL =
    import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:5000/api");

export function clientHeaders(): Record<string, string> {
    return {
        "X-AINO-Client": import.meta.env.VITE_ELECTRON ? "desktop" : "web",
        "X-AINO-Client-Version": webBuildVersion,
    };
}

export function isFirstPartyApi(input: string): boolean {
    try {
        const target = new URL(input, window.location.href);
        const api = new URL(apiBaseURL, window.location.href);
        const sameOrigin = (a: URL, b: URL) => a.protocol === b.protocol && a.host === b.host;
        return (sameOrigin(target, api) || sameOrigin(target, new URL(window.location.href)))
            && (target.pathname === "/api" || target.pathname.startsWith("/api/"));
    } catch { return false; }
}

export function apiRequestTarget(url = "", base = apiBaseURL): string {
    return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) ? url
        : `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}
