import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api }));
import PollCreator from "./PollCreator";
import useMessageActions from "../../pages/chat/useMessageActions";

function state(activeConv: { id: number } | null = { id: 7 }) {
    return { activeConv, setShowPollCreator: vi.fn(), uploadControllersRef: { current: new Map() },
        mentionInputRef: { current: null }, selectedMessageIds: new Set(), pendingCounter: { current: 0 } } as any;
}
function fillDraft() {
    fireEvent.change(screen.getByLabelText("QUESTION"), { target: { value: " Lunch? " } });
    fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: " Pizza " } });
    fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: " Pasta " } });
}
function deferred() {
    let resolve!: (data: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

beforeEach(() => api.post.mockReset().mockResolvedValue({ data: { ok: true } }));
afterEach(cleanup);

describe("poll creation integration", () => {
    test("awaits API success, submits trimmed answers/default single select, ignores duplicate sends and dismissals", async () => {
        const response = deferred();
        api.post.mockReturnValue(response.promise);
        const current = state();
        const { result } = renderHook(() => useMessageActions(current));
        const close = vi.fn();
        render(<PollCreator onSubmit={result.current.handleCreatePoll} onClose={close} />);
        fillDraft();
        fireEvent.click(screen.getByRole("button", { name: "Add option" }));
        const form = screen.getByRole("dialog");
        fireEvent.submit(form);
        fireEvent.submit(form);
        fireEvent.keyDown(form, { key: "Escape" });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post).toHaveBeenCalledWith("/chat/conversations/7/polls", {
            question: "Lunch?", options: ["Pizza", "Pasta"], multiSelect: false,
        });
        expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
        expect(screen.getByLabelText("QUESTION")).toBeDisabled();
        fireEvent.keyDown(form, { key: "Tab" });
        expect(form).toHaveFocus();
        expect(close).not.toHaveBeenCalled();
        await act(async () => response.resolve({ data: { ok: true } }));
        expect(close).toHaveBeenCalledTimes(1);
        expect(current.setShowPollCreator).not.toHaveBeenCalled();
    });
    test("async failure retains complete draft and options/multi-select, reports server error, permits manual retry", async () => {
        api.post.mockRejectedValueOnce({ response: { data: { error: "Poll could not be sent" } } });
        const { result } = renderHook(() => useMessageActions(state()));
        const close = vi.fn();
        render(<PollCreator onSubmit={result.current.handleCreatePoll} onClose={close} />);
        fillDraft();
        fireEvent.click(screen.getByRole("button", { name: "Add option" }));
        fireEvent.change(screen.getByLabelText("Option 3"), { target: { value: " Salad " } });
        fireEvent.click(screen.getByLabelText("Allow multiple answers"));
        fireEvent.click(screen.getByRole("button", { name: "Send Poll" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Poll could not be sent");
        expect(screen.getByLabelText("QUESTION")).toHaveValue(" Lunch? ");
        expect(screen.getByLabelText("Option 3")).toHaveValue(" Salad ");
        expect(screen.getByLabelText("Allow multiple answers")).toBeChecked();
        expect(close).not.toHaveBeenCalled();
        expect(api.post).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Send Poll" }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(api.post).toHaveBeenLastCalledWith("/chat/conversations/7/polls", {
            question: "Lunch?", options: ["Pizza", "Pasta", "Salad"], multiSelect: true,
        });
    });
    test("failed success flag does not close, and missing conversation rejects rather than pretending success", async () => {
        api.post.mockResolvedValueOnce({ data: { ok: false } });
        const { result } = renderHook(() => useMessageActions(state()));
        const close = vi.fn();
        const view = render(<PollCreator onSubmit={result.current.handleCreatePoll} onClose={close} />);
        fillDraft();
        fireEvent.click(screen.getByRole("button", { name: "Send Poll" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not create poll");
        expect(close).not.toHaveBeenCalled();
        view.unmount();
        const missing = renderHook(() => useMessageActions(state(null)));
        await expect(missing.result.current.handleCreatePoll({ question: "q", options: ["a", "b"], multiSelect: false })).rejects.toThrow(/conversation/);
    });
    test("2–10 stable options, field limits and blank validation hold in UI", () => {
        render(<PollCreator onSubmit={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByRole("button", { name: /Remove option/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Send Poll" })).toBeDisabled();
        fillDraft();
        for (let index = 0; index < 8; index++) fireEvent.click(screen.getByRole("button", { name: "Add option" }));
        expect(screen.getByRole("button", { name: "Maximum of 10 options" })).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Option 3"), { target: { value: "third" } });
        fireEvent.click(screen.getByRole("button", { name: "Remove option 2" }));
        expect(screen.getByLabelText("Option 2")).toHaveValue("third");
        expect(screen.getByLabelText("QUESTION")).toHaveAttribute("maxLength", "500");
        expect(screen.getByLabelText("Option 1")).toHaveAttribute("maxLength", "200");
        fireEvent.change(screen.getByLabelText("QUESTION"), { target: { value: "q".repeat(501) } });
        fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "a".repeat(201) } });
        expect(screen.getByLabelText("QUESTION")).toHaveValue("q".repeat(500));
        expect(screen.getByLabelText("Option 1")).toHaveValue("a".repeat(200));
    });
    test("late completion after unmount does not dismiss another creator", async () => {
        const response = deferred();
        const close = vi.fn();
        const view = render(<PollCreator onSubmit={() => response.promise as Promise<void>} onClose={close} />);
        fillDraft();
        fireEvent.click(screen.getByRole("button", { name: "Send Poll" }));
        view.unmount();
        await act(async () => response.resolve(undefined));
        expect(close).not.toHaveBeenCalled();
    });
});
