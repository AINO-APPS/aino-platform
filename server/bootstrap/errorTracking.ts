/**
 * Error tracking (P2.2): Sentry, enabled only when `SENTRY_DSN` is set, so
 * local runs, tests and self-hosted installs send nothing anywhere.
 *
 * Privacy: no request bodies, cookies, auth headers, query strings, IP
 * addresses or emails leave the server. Events carry only the numeric user
 * id and tenant id (`setErrorUser`), the route, and the stack trace.
 */
import type { ErrorEvent, EventHint } from "@sentry/node";

let enabled = false;
let sentry: typeof import("@sentry/node") | null = null;

const SENSITIVE_HEADERS = /^(authorization|cookie|set-cookie|x-aino-device-id|x-csrf-token|proxy-authorization)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** Mask emails and tokens in free text (exception messages, breadcrumbs). */
export function scrubText(value: string): string {
    return value.replace(BEARER, "$1[redacted]").replace(JWT, "[jwt]").replace(EMAIL, "[email]");
}

/** Remove request data and personal fields before an event leaves the process. */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
    if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split("?")[0];
        if (event.request.headers) {
            for (const name of Object.keys(event.request.headers)) {
                if (SENSITIVE_HEADERS.test(name)) delete event.request.headers[name];
            }
        }
    }
    if (event.user) event.user = { id: event.user.id };
    for (const exception of event.exception?.values || []) {
        if (exception.value) exception.value = scrubText(exception.value);
    }
    if (event.message) event.message = scrubText(event.message);
    for (const crumb of event.breadcrumbs || []) {
        if (crumb.message) crumb.message = scrubText(crumb.message);
        delete crumb.data;
    }
    return event;
}

/** Start Sentry when configured. Call once, before the app is built. */
export function initErrorTracking(): void {
    const dsn = process.env.SENTRY_DSN;
    if (enabled || !dsn || process.env.NODE_ENV === "test") return;
    sentry = require("@sentry/node") as typeof import("@sentry/node");
    sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
        release: process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
        // Collect nothing personal at the source; scrubEvent is the second line of defence.
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: { allow: ["user-agent", "content-type", "x-aino-client"] },
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
            queues: false,
            stackFrameVariables: false,
            genAI: { inputs: false, outputs: false },
            graphQL: { document: false, variables: false },
        },
        tracesSampleRate: 0,
        beforeSend: scrubEvent,
        beforeBreadcrumb: (crumb) => (crumb.category === "http" || crumb.category === "console" ? null : crumb),
        initialScope: { tags: { role: (process.env.ROLE || "all").toLowerCase() } },
    });
    enabled = true;
}

/** Report an error that was handled (logged and answered with a 5xx). No-op when disabled. */
export function captureError(err: unknown, context: { userId?: number | null; tenantId?: number | string | null; route?: string } = {}): void {
    if (!enabled || !sentry) return;
    sentry.withScope((scope) => {
        if (context.userId) scope.setUser({ id: String(context.userId) });
        if (context.tenantId) scope.setTag("tenant_id", String(context.tenantId));
        if (context.route) scope.setTag("route", context.route);
        sentry!.captureException(err);
    });
}

/** Flush queued events before the process exits (crash handler). */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
    if (!enabled || !sentry) return;
    await sentry.flush(timeoutMs).catch(() => undefined);
}

export function errorTrackingEnabled(): boolean {
    return enabled;
}
