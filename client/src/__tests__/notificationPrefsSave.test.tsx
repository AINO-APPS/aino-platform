import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NotificationPrefsProvider, useNotificationPrefs } from "../NotificationPrefsContext";

const mocks = vi.hoisted(() => ({
    auth: { isAuthenticated: true, user: { id: 1, tenant_id: 2, notification_prefs: { messageTone: "legacy-tone", readReceipts: false } as Record<string, unknown> } },
    getPrefs: vi.fn(), updatePrefs: vi.fn(), toast: { error: vi.fn() },
}));
vi.mock("../AuthContext", () => ({ useAuth: () => mocks.auth, hasTenantContext: () => true }));
vi.mock("../components/common/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../api/organization", () => ({ getNotificationPrefs: mocks.getPrefs, updateNotificationPrefs: mocks.updatePrefs }));

let captured: ReturnType<typeof useNotificationPrefs>;
function Probe() { captured = useNotificationPrefs(); return null; }

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    mocks.updatePrefs.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("two quick updates send one PUT containing only the changed keys", async () => {
    render(<NotificationPrefsProvider><Probe /></NotificationPrefsProvider>);
    act(() => captured.updatePrefs({ ringtone: "crystal" }));
    act(() => captured.updatePrefs({ ringtoneVolume: 0.4 }));
    await act(async () => vi.advanceTimersByTime(499));
    expect(mocks.updatePrefs).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.updatePrefs).toHaveBeenCalledTimes(1);
    expect(mocks.updatePrefs.mock.calls[0][0]).toEqual({ ringtone: "crystal", ringtoneVolume: 0.4 });
    expect(captured.prefs).toMatchObject({ ringtone: "crystal", ringtoneVolume: 0.4, messageTone: "legacy-tone" });
    expect(JSON.parse(localStorage.getItem("workpulse.notificationPrefs:2:1") ?? "{}")).toMatchObject({ ringtone: "crystal", ringtoneVolume: 0.4 });
});

test("the pending partial is cleared after sending", async () => {
    render(<NotificationPrefsProvider><Probe /></NotificationPrefsProvider>);
    act(() => captured.updatePrefs({ ringtone: "vapor" }));
    await act(async () => vi.advanceTimersByTime(500));
    act(() => captured.updatePrefs({ reactionTone: "click" }));
    await act(async () => vi.advanceTimersByTime(500));
    expect(mocks.updatePrefs).toHaveBeenCalledTimes(2);
    expect(mocks.updatePrefs.mock.calls[1][0]).toEqual({ reactionTone: "click" });
});

test("a failed save still shows the error toast", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updatePrefs.mockRejectedValueOnce(new Error("400"));
    render(<NotificationPrefsProvider><Probe /></NotificationPrefsProvider>);
    act(() => captured.updatePrefs({ mentionTone: "spark" }));
    await act(async () => vi.advanceTimersByTime(500));
    expect(mocks.toast.error).toHaveBeenCalledWith("Notification preferences could not be saved. Please try again.");
});
