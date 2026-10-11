import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ChatPoll } from "../../api/chat";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api, serverURL: "https://aino.example" }));
import PollDisplay from "./PollDisplay";

function deferred<T>() {
    let resolve!: (data: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const voter = (userId: number | string, fullName: string, avatar: string | null = null) => ({ userId, fullName, avatar });
const poll = (overrides: Partial<ChatPoll> = {}): ChatPoll => ({ id: 7, question: "Lunch?",
    options: ["Pizza", "Pasta", "Salad"], votes: {}, multi_select: false, ...overrides });
const reply = (data: ChatPoll) => ({ data });
const realtime = (pollId: unknown = "7") => act(() => {
    window.dispatchEvent(new CustomEvent("poll_vote_update", { detail: { pollId, votes: { 0: [999] } } }));
});
const option = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label},`) });

beforeEach(() => {
    api.get.mockReset().mockResolvedValue(reply(poll()));
    api.post.mockReset().mockResolvedValue({ data: { ok: true, votes: { 0: [1] } } });
});
afterEach(cleanup);

describe("poll display and rich API integration", () => {
    test("GET uses rich voters, mutation reloads rich names/avatars instead of applying ID-only votes", async () => {
        const before = poll({ votes: { 0: [voter(1, "Alice Smith", "/alice.png")] } });
        const after = poll({ votes: { 1: [voter("1", "Alice Smith", "/alice-new.png")] } });
        api.get.mockResolvedValueOnce(reply(before)).mockResolvedValueOnce(reply(after));
        render(<PollDisplay pollId="7" userId="1" />);
        expect(await screen.findByRole("button", { name: /Pizza, 1 vote, 100 percent, selected/ })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(option("Pasta"));
        await waitFor(() => expect(option("Pasta")).toHaveAttribute("aria-pressed", "true"));
        expect(api.post).toHaveBeenCalledWith("/chat/polls/7/vote", { optionIdx: 1 });
        expect(api.get).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole("button", { name: "View votes" }));
        const dialog = screen.getByRole("dialog", { name: "Poll votes" });
        expect(within(dialog).getByText("You")).toBeInTheDocument();
        expect(dialog.querySelector("img")).toHaveAttribute("src", "https://aino.example/alice-new.png");
        expect(within(dialog).getByText("AS")).toBeInTheDocument();
    });
    test("multiple-choice toggles preserve other selections and rich results", async () => {
        api.get.mockResolvedValueOnce(reply(poll({ multi_select: true, votes: { 0: [voter(1, "Alice")] } })))
            .mockResolvedValueOnce(reply(poll({ multi_select: true, votes: { 0: [voter(1, "Alice")], 1: [voter(1, "Alice")] } })))
            .mockResolvedValueOnce(reply(poll({ multi_select: true, votes: { 1: [voter(1, "Alice")] } })));
        render(<PollDisplay pollId={7} userId="1" />);
        await screen.findByRole("button", { name: /Pizza, 1 vote/ });
        fireEvent.click(option("Pasta"));
        await waitFor(() => expect(option("Pasta")).toHaveAttribute("aria-pressed", "true"));
        expect(option("Pizza")).toHaveAttribute("aria-pressed", "true");
        expect(option("Pizza")).toHaveAccessibleName("Pizza, 1 vote, 50 percent, selected");
        fireEvent.click(option("Pizza"));
        await waitFor(() => expect(option("Pizza")).toHaveAttribute("aria-pressed", "false"));
        expect(option("Pasta")).toHaveAttribute("aria-pressed", "true");
        expect(api.post).toHaveBeenCalledTimes(2);
    });
    test("interactive poll touch does not let bubble prevent its click, selection touches still bubble", async () => {
        const touch = vi.fn((event: React.TouchEvent) => event.preventDefault());
        const view = render(<div onTouchEnd={touch}><PollDisplay pollId={7} /></div>);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        fireEvent.touchEnd(option("Pizza"));
        expect(touch).not.toHaveBeenCalled();
        view.rerender(<div onTouchEnd={touch}><PollDisplay pollId={7} interactionEnabled={false} /></div>);
        fireEvent.touchEnd(option("Pizza"));
        expect(touch).toHaveBeenCalledTimes(1);
    });
    test("selected single-choice option sends one toggle with no automatic retry on failure", async () => {
        const pending = deferred<{ data: { ok: boolean } }>();
        api.get.mockResolvedValue(reply(poll({ votes: { 0: [voter("1", "Alice")] } })));
        api.post.mockReturnValue(pending.promise);
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 1 vote/ });
        fireEvent.click(option("Pizza"));
        fireEvent.click(option("Pizza"));
        expect(option("Pizza")).toBeDisabled();
        expect(option("Pizza")).toHaveAttribute("aria-busy", "true");
        await act(async () => pending.reject({ response: { data: { error: "Voting unavailable" } } }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Voting unavailable");
        expect(option("Pizza")).not.toBeDisabled();
        expect(option("Pizza")).toHaveAttribute("aria-pressed", "true");
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.get).toHaveBeenCalledTimes(1);
    });
    test("successful vote with failed rich refresh retains identities and retries GET only", async () => {
        api.get.mockResolvedValueOnce(reply(poll({ votes: { 0: [voter(1, "Alice")] } })))
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(reply(poll({ votes: { 1: [voter(1, "Alice")] } })));
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 1 vote/ });
        fireEvent.click(option("Pasta"));
        expect(await screen.findByRole("alert")).toHaveTextContent("Vote sent, but results could not refresh");
        expect(option("Pizza")).toHaveAttribute("aria-pressed", "true");
        expect(option("Pasta")).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(option("Pasta")).toHaveAttribute("aria-pressed", "true"));
        expect(api.post).toHaveBeenCalledTimes(1);
    });
    test("initial load failure is visible, has retry, and does not stay on loading", async () => {
        api.get.mockRejectedValueOnce(new Error("offline"));
        render(<PollDisplay pollId={7} />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not load votes");
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    test("realtime burst coalesces serial rich GETs and never applies a stale response", async () => {
        const stale = deferred<ReturnType<typeof reply>>();
        const latest = deferred<ReturnType<typeof reply>>();
        api.get.mockResolvedValueOnce(reply(poll())).mockReturnValueOnce(stale.promise).mockReturnValueOnce(latest.promise);
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        realtime(7); realtime("7"); realtime(7); realtime("elsewhere");
        expect(api.get).toHaveBeenCalledTimes(2);
        await act(async () => stale.resolve(reply(poll({ question: "Stale question", votes: { 0: [voter(99, "Stale")] } }))));
        expect(api.get).toHaveBeenCalledTimes(3);
        expect(screen.queryByText("Stale question")).not.toBeInTheDocument();
        await act(async () => latest.resolve(reply(poll({ votes: { 1: [voter(1, "Alice Smith", "/a.png")] } }))));
        expect(option("Pasta")).toHaveAttribute("aria-pressed", "true");
        expect(api.get).toHaveBeenCalledTimes(3);
        fireEvent.click(screen.getByRole("button", { name: "View votes" }));
        expect(screen.getByText("You")).toBeInTheDocument();
    });
    test("realtime during mutation waits then refreshes, another event during GET schedules one followup", async () => {
        const mutation = deferred<{ data: { ok: boolean } }>();
        const stale = deferred<ReturnType<typeof reply>>();
        api.get.mockResolvedValueOnce(reply(poll())).mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce(reply(poll({ votes: { 0: [voter(1, "Alice")] } })));
        api.post.mockReturnValue(mutation.promise);
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        fireEvent.click(option("Pizza"));
        realtime(); realtime();
        expect(api.get).toHaveBeenCalledTimes(1);
        await act(async () => mutation.resolve({ data: { ok: true } }));
        expect(api.get).toHaveBeenCalledTimes(2);
        realtime(); realtime();
        await act(async () => stale.resolve(reply(poll())));
        expect(api.get).toHaveBeenCalledTimes(3);
        expect(option("Pizza")).toHaveAttribute("aria-pressed", "true");
        expect(api.post).toHaveBeenCalledTimes(1);
    });
    test("realtime refresh failure is retryable and preserves loaded results", async () => {
        api.get.mockResolvedValueOnce(reply(poll({ votes: { 0: [voter(1, "Alice")] } })))
            .mockRejectedValueOnce(new Error("offline"));
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 1 vote/ });
        realtime();
        expect(await screen.findByRole("alert")).toHaveTextContent("Could not load votes");
        expect(option("Pizza")).toHaveAttribute("aria-pressed", "true");
    });
    test("changing polls ignores late GETs; unmount removes realtime and late mutation refresh", async () => {
        const stale = deferred<ReturnType<typeof reply>>();
        const mutation = deferred<{ data: { ok: boolean } }>();
        api.get.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(reply(poll({ id: 8, question: "New poll" })));
        api.post.mockReturnValue(mutation.promise);
        const view = render(<PollDisplay pollId={7} />);
        view.rerender(<PollDisplay pollId={8} />);
        await screen.findByText("New poll");
        await act(async () => stale.resolve(reply(poll({ question: "Old poll" }))));
        expect(screen.queryByText("Old poll")).not.toBeInTheDocument();
        fireEvent.click(option("Pizza"));
        view.unmount();
        await act(async () => mutation.resolve({ data: { ok: true } }));
        realtime(8);
        expect(api.get).toHaveBeenCalledTimes(2);
    });
    test("closed polls show results only; selection mode bubbles selection without voting/opening dialog", async () => {
        const select = vi.fn();
        api.get.mockResolvedValue(reply(poll({ closed_at: "2026-10-11" })));
        const view = render(<div onClick={select}><PollDisplay pollId={7} /></div>);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        expect(option("Pizza")).toBeDisabled();
        expect(screen.getByText("Poll closed · Results only")).toBeInTheDocument();
        view.rerender(<div onClick={select}><PollDisplay pollId={7} interactionEnabled={false} /></div>);
        fireEvent.click(option("Pizza"));
        expect(select).toHaveBeenCalledTimes(1);
        expect(api.post).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "View votes" })).toBeDisabled();
    });
});

describe("grouped accessible live results", () => {
    test("includes all empty groups with no leader and no votes explanation", async () => {
        render(<PollDisplay pollId={7} />);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        fireEvent.click(screen.getByRole("button", { name: "View votes" }));
        const dialog = screen.getByRole("dialog", { name: "Poll votes" });
        expect(within(dialog).getAllByText("No votes for this option")).toHaveLength(3);
        expect(within(dialog).getByText(/No votes yet/)).toBeInTheDocument();
        expect(within(dialog).queryByText(/Most votes|Tied for most votes/)).not.toBeInTheDocument();
    });
    test("You is first with real initials; five/show more per group, ties and unique people count update live", async () => {
        const voters = [voter(2, "Zoe"), voter(3, "Amy"), voter(4, "Bob"), voter(5, "Cora"), voter(6, "Dan"), voter(1, "Alice Smith", "/a.png")];
        api.get.mockResolvedValueOnce(reply(poll({ multi_select: true, votes: { 0: voters, 1: voters } })))
            .mockResolvedValueOnce(reply(poll({ multi_select: true, votes: { 0: [...voters, voter(7, "Eve")], 1: voters } })));
        render(<PollDisplay pollId={7} userId="1" />);
        await screen.findByRole("button", { name: /Pizza, 6 votes, 50 percent/ });
        fireEvent.click(screen.getByRole("button", { name: "View votes" }));
        const dialog = screen.getByRole("dialog", { name: "Poll votes" });
        const pizza = within(dialog).getByRole("region", { name: "Pizza" });
        const pasta = within(dialog).getByRole("region", { name: "Pasta" });
        expect(within(dialog).getByText("12 votes · 6 people")).toBeInTheDocument();
        expect(within(dialog).getByText(/a person may vote for several options/)).toBeInTheDocument();
        expect(within(dialog).getAllByText("Tied for most votes")).toHaveLength(2);
        expect(within(pizza).getAllByRole("listitem")).toHaveLength(5);
        expect(within(pizza).getAllByRole("listitem")[0]).toHaveTextContent("ASYou");
        fireEvent.click(within(pizza).getByRole("button", { name: "Show 1 more" }));
        expect(within(pizza).getAllByRole("listitem")).toHaveLength(6);
        expect(within(pasta).getAllByRole("listitem")).toHaveLength(5);
        realtime();
        await waitFor(() => expect(within(dialog).getByText("13 votes · 7 people")).toBeInTheDocument());
        expect(within(pizza).getAllByRole("listitem")).toHaveLength(7);
        expect(within(pizza).getByText("Most votes")).toBeInTheDocument();
        fireEvent.click(within(pizza).getByRole("button", { name: "Show fewer" }));
        expect(within(pizza).getAllByRole("listitem")).toHaveLength(5);
    });
    test("avatar uses photo only after load, initials on loading/error and resets on new avatar", async () => {
        api.get.mockResolvedValueOnce(reply(poll({ votes: { 0: [voter(1, "Alice Smith", "/old.png")] } })))
            .mockResolvedValueOnce(reply(poll({ votes: { 0: [voter(1, "Alice Smith", "/new.png")] } })));
        render(<PollDisplay pollId={7} userId={1} />);
        await screen.findByRole("button", { name: /Pizza, 1 vote/ });
        fireEvent.click(screen.getByRole("button", { name: "View votes" }));
        const dialog = screen.getByRole("dialog", { name: "Poll votes" });
        let image = dialog.querySelector("img")!;
        expect(image.className).toContain("avatarLoading");
        expect(image).toHaveAttribute("alt", "");
        expect(image.parentElement).toHaveAttribute("aria-hidden", "true");
        expect(within(dialog).getByText("AS")).toBeInTheDocument();
        fireEvent.load(image);
        expect(image.className).toContain("avatarLoaded");
        fireEvent.error(image);
        expect(dialog.querySelector("img")).toBeNull();
        expect(within(dialog).getByText("AS")).toBeInTheDocument();
        realtime();
        await waitFor(() => expect(dialog.querySelector("img")).toHaveAttribute("src", "https://aino.example/new.png"));
        image = dialog.querySelector("img")!;
        expect(image.className).toContain("avatarLoading");
    });
    test("dialog traps focus, Escape closes and restores View votes focus", async () => {
        render(<PollDisplay pollId={7} />);
        await screen.findByRole("button", { name: /Pizza, 0 votes/ });
        const trigger = screen.getByRole("button", { name: "View votes" });
        trigger.focus();
        fireEvent.click(trigger);
        const close = screen.getByRole("button", { name: "Close votes" });
        expect(close).toHaveFocus();
        fireEvent.keyDown(close, { key: "Tab" });
        expect(close).toHaveFocus();
        fireEvent.keyDown(close, { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
