import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NotificationPrefsProvider, useNotificationPrefs } from "../NotificationPrefsContext";

const mocks = vi.hoisted(() => ({
    auth: { isAuthenticated: true, user: { id: 1, tenant_id: 2, notification_prefs: undefined as Record<string, unknown> | undefined } },
    getPrefs: vi.fn(), updatePrefs: vi.fn(), toast: { error: vi.fn() },
}));
vi.mock("../AuthContext", () => ({ useAuth: () => mocks.auth, hasTenantContext: () => true }));
vi.mock("../components/common/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../api/organization", () => ({ getNotificationPrefs: mocks.getPrefs, updateNotificationPrefs: mocks.updatePrefs }));
let captured: ReturnType<typeof useNotificationPrefs>;
function Probe() { captured = useNotificationPrefs(); return null; }
function tree() { return <NotificationPrefsProvider><Probe /></NotificationPrefsProvider>; }
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.user = { id: 1, tenant_id: 2, notification_prefs: undefined };
    mocks.getPrefs.mockResolvedValue({ data: {} });
    mocks.updatePrefs.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

test("withholds readiness until canonical privacy preferences have loaded", async () => {
    let resolve: ((value: { data: Record<string, unknown> }) => void) | undefined;
    mocks.getPrefs.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(tree());
    expect(captured.prefsLoaded).toBe(false);
    await act(async () => resolve?.({ data: { hideSensitiveContent: true, messagePopups: false } }));
    expect(captured.prefsLoaded).toBe(true);
    expect(captured.prefs).toMatchObject({ hideSensitiveContent: true, messagePopups: false });
});
test("failed preference loading is explicit and retries on focus without exposing defaults", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPrefs.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ data: { hideSensitiveContent: true } });
    render(tree());
    await act(async () => { await Promise.resolve(); });
    expect(captured.prefsLoaded).toBe(false);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(captured.prefsLoaded).toBe(true);
    expect(captured.prefs.hideSensitiveContent).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.getPrefs).toHaveBeenCalledTimes(2);
});
test("repeated failed retries report the paused alerts only once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getPrefs.mockRejectedValue(new Error("offline"));
    render(tree());
    await act(async () => { await Promise.resolve(); });
    for (let i = 0; i < 3; i++) await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(mocks.getPrefs).toHaveBeenCalledTimes(4);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(captured.prefsLoaded).toBe(false);
});
test("debounced changes persist only the changed settings without losing a preceding toggle", async () => {
    vi.useFakeTimers();
    mocks.auth.user.notification_prefs = { readReceipts: false, messageTone: "soft" };
    const view = render(tree());
    act(() => captured.updatePrefs({ messagePopups: false }));
    act(() => captured.updatePrefs({ hideSensitiveContent: true }));
    await act(async () => vi.advanceTimersByTime(500));
    expect(mocks.updatePrefs).toHaveBeenCalledTimes(1);
    expect(mocks.updatePrefs.mock.calls[0][0]).toEqual({ messagePopups: false, hideSensitiveContent: true });
    expect(captured.prefs).toMatchObject({ messagePopups: false, hideSensitiveContent: true, readReceipts: false });
    act(() => captured.updatePrefs({ messagePopups: true }));
    view.unmount();
    await act(async () => vi.advanceTimersByTime(500));
    expect(mocks.updatePrefs).toHaveBeenCalledTimes(1);
});
test("account changes cannot reuse another user's notification settings", async () => {
    mocks.auth.user.notification_prefs = { hideSensitiveContent: true, messagePopups: false };
    const view = render(tree());
    expect(captured.prefs.hideSensitiveContent).toBe(true);
    mocks.auth.user = { id: 9, tenant_id: 4, notification_prefs: {} };
    view.rerender(tree());
    expect(captured.prefs).toMatchObject({ hideSensitiveContent: false, messagePopups: true });
    expect(localStorage.getItem("workpulse.notificationPrefs:4:9")).not.toContain('"hideSensitiveContent":true');
});
