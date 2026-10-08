import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockSubmit = vi.fn();
vi.mock("../api/workforce", () => ({
    submitWorkModeRequest: (...args: unknown[]) => mockSubmit(...args),
}));

import WorkModeChangeDialog, { handleWorkModeLocked } from "../components/attendance/WorkModeChangeDialog";
import WorkModeLockHint, { preferredWorkMode } from "../components/attendance/WorkModeLockHint";

const lockedError = {
    response: { status: 409, data: { code: "WORK_MODE_LOCKED", locked_mode: "office", requested_mode: "remote", error: "locked" } },
};

describe("work-mode lock (web)", () => {
    // Block body: Vitest treats a function returned from beforeEach as teardown.
    beforeEach(() => { mockSubmit.mockReset(); });
    afterEach(() => cleanup());

    test("other errors are not treated as the lock", () => {
        expect(handleWorkModeLocked({ response: { data: { code: "FACE_MISMATCH" } } })).toBe(false);
        expect(handleWorkModeLocked(new Error("network"))).toBe(false);
    });

    test("a locked clock-in opens the request dialog and sends the request", async () => {
        mockSubmit.mockResolvedValue({ data: { status: "pending" } });
        render(<WorkModeChangeDialog />);
        act(() => { expect(handleWorkModeLocked(lockedError)).toBe(true); });

        expect(screen.getByText("Work mode change needs approval")).toBeTruthy();
        fireEvent.click(screen.getByText("Request change"));
        expect(screen.getByRole("alert").textContent).toMatch(/reason/);
        expect(mockSubmit).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Doctor visit" } });
        fireEvent.click(screen.getByText("Request change"));
        await waitFor(() => expect(screen.getByText("Request sent")).toBeTruthy());
        expect(mockSubmit).toHaveBeenCalledWith({ work_mode: "remote", reason: "Doctor visit" });
    });

    test("server rejection is shown in the dialog", async () => {
        const conflict = new Error("Request failed with status code 409") as Error & { response?: unknown };
        conflict.response = { data: { error: "You already have a pending work mode change request for today." } };
        mockSubmit.mockRejectedValue(conflict);
        render(<WorkModeChangeDialog />);
        act(() => { handleWorkModeLocked(lockedError); });
        fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "x" } });
        fireEvent.click(screen.getByText("Request change"));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(screen.getByRole("alert").textContent).toMatch(/already have a pending/);
    });

    test("preselects today's locked mode, or an approved switch, while logged out", () => {
        expect(preferredWorkMode({ state: "logged_out", workMode: "remote", lockedWorkMode: "office" })).toBe("office");
        expect(preferredWorkMode({
            state: "logged_out", lockedWorkMode: "office",
            workModeRequest: { status: "approved", workMode: "remote" },
        })).toBe("remote");
        expect(preferredWorkMode({ state: "on_floor", workMode: "remote", lockedWorkMode: "office" })).toBe("remote");
        expect(preferredWorkMode({ state: "logged_out", lockedWorkMode: null, workMode: "office" })).toBe("office");
    });

    test("hint explains the lock and the request state", () => {
        const { rerender } = render(<WorkModeLockHint lockedWorkMode="office" workModeRequest={null} />);
        expect(screen.getByRole("status").textContent).toMatch(/Today: Office. Switching needs manager approval/);
        rerender(<WorkModeLockHint lockedWorkMode="office" workModeRequest={{ status: "pending", workMode: "remote" }} />);
        expect(screen.getByRole("status").textContent).toMatch(/Remote requested, waiting/);
        rerender(<WorkModeLockHint lockedWorkMode="office" workModeRequest={{ status: "approved", workMode: "remote" }} />);
        expect(screen.getByRole("status").textContent).toMatch(/Remote approved/);
        rerender(<WorkModeLockHint lockedWorkMode={null} workModeRequest={null} />);
        expect(screen.queryByRole("status")).toBeNull();
    });
});
