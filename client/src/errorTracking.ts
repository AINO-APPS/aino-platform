/**
 * Error tracking for the web app and the desktop renderer (P2.2). Sentry is
 * loaded only when `VITE_SENTRY_DSN` is set at build time; otherwise nothing
 * is downloaded or sent. No request bodies, cookies, query strings, emails or
 * session replays leave the browser: only the stack trace, the route path and
 * the numeric user / tenant id.
 */
type SentryModule = typeof import("@sentry/react");

let sentry: SentryModule | null = null;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function scrubText(value: string): string {
  return value.replace(BEARER, "$1[redacted]").replace(JWT, "[jwt]").replace(EMAIL, "[email]");
}

export function scrubEvent<T>(input: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = input as any;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.headers;
    if (event.request.url) event.request.url = String(event.request.url).split("?")[0].split("#")[0];
  }
  if (event.user) event.user = { id: event.user.id };
  for (const exception of event.exception?.values || []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.message) event.message = scrubText(event.message);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter((crumb: { category?: string }) => crumb.category !== "console" && crumb.category !== "ui.input")
      .map((crumb: { message?: string; data?: unknown }) => {
        if (crumb.message) crumb.message = scrubText(crumb.message);
        delete crumb.data;
        return crumb;
      });
  }
  return input;
}

export async function initErrorTracking(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || sentry) return;
  const module = await import("@sentry/react");
  module.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (event) => scrubEvent(event),
    initialScope: { tags: { client: import.meta.env.VITE_ELECTRON ? "desktop" : "web" } },
  });
  sentry = module;
}

/** Tag later events with the signed-in user's numeric ids (null on sign-out). */
export function setErrorUser(user: { id?: number | string; tenant_id?: number | string | null } | null): void {
  if (!sentry) return;
  sentry.setUser(user?.id != null ? { id: String(user.id) } : null);
  sentry.setTag("tenant_id", user?.tenant_id != null ? String(user.tenant_id) : undefined);
}

export function captureError(error: unknown, extra?: { componentStack?: string }): void {
  if (!sentry) return;
  sentry.captureException(error, extra?.componentStack ? { contexts: { react: { componentStack: extra.componentStack } } } : undefined);
}
