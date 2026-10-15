import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SidebarMenuOptions } from "../pages/chat/SidebarTopBar";

const mocks = vi.hoisted(() => ({ getAllCallHistory: vi.fn() }));
vi.mock("../FeaturesContext", () => ({ useFeatures: () => ({ hasFeature: () => true }) }));
vi.mock("../api/chat", () => ({ getAllCallHistory: mocks.getAllCallHistory, deleteCalls: vi.fn() }));
vi.mock("../components/profile/NotificationSoundsModal", () => ({
    default: ({ onClose }: { onClose: () => void }) => (
        <div role="dialog" aria-label="Chat settings">
            <button onClick={onClose}>Done</button>
        </div>
    ),
}));
vi.mock("../pages/chat/ConversationItem", () => ({
    default: ({ conv, selected }: { conv: { id: number; name: string }; selected?: boolean }) => (
        <div data-testid="conv">{`${conv.name}${selected ? " (selected)" : ""}`}</div>
    ),
}));
vi.mock("../pages/chat/chatUtils", () => ({ getConvName: (c: { name: string }) => c.name }));
import SidebarTopBar, { sidebarMenuItems } from "../pages/chat/SidebarTopBar";
import ChatSidebar from "../pages/chat/ChatSidebar";

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const noop = () => {};
function options(overrides: Partial<SidebarMenuOptions> = {}): SidebarMenuOptions {
    return {
        tab: "msgs",
        showArchived: false,
        archivedCount: 2,
        canMarkAllRead: true,
        canSelect: true,
        onNewChat: vi.fn(),
        onNewGroup: vi.fn(),
        onMarkAllRead: vi.fn(),
        onSelect: vi.fn(),
        onToggleArchived: vi.fn(),
        onRefresh: vi.fn(),
        onOpenSettings: vi.fn(),
        ...overrides,
    };
}
const labels = (o: SidebarMenuOptions) =>
    sidebarMenuItems(o).map((e) => (!e ? null : "divider" in e ? "—" : e.label)).filter(Boolean);

describe("sidebarMenuItems", () => {
    test("per-tab entries match the Android chat list", () => {
        expect(labels(options())).toEqual([
            "New chat", "New group", "—", "Mark all as read", "Select chats", "Archived chats", "—", "Refresh", "Settings",
        ]);
        expect(labels(options({ showArchived: true }))).toEqual([
            "Mark all as read", "Select chats", "Back to chats", "—", "Refresh", "Settings",
        ]);
        expect(labels(options({ tab: "meetings" }))).toEqual(["Mark all as read", "Select chats", "—", "Refresh"]);
        expect(labels(options({ tab: "calls" }))).toEqual(["Select calls", "—", "Refresh"]);
    });

    test("disables mark-all-read / select when there is nothing to act on", () => {
        const items = sidebarMenuItems(options({ canMarkAllRead: false, canSelect: false }));
        const find = (label: string) => items.find((e) => e && !("divider" in e) && e.label === label) as { disabled?: boolean };
        expect(find("Mark all as read").disabled).toBe(true);
        expect(find("Select chats").disabled).toBe(true);
    });
});

describe("SidebarTopBar overflow menu", () => {
    function renderBar(o: SidebarMenuOptions) {
        render(
            <SidebarTopBar
                {...o}
                onTab={noop}
                unread={0}
                meetingUnread={0}
                meetingsEnabled
                search=""
                setSearch={noop}
                searchOpen={false}
                onSearchOpen={noop}
                searchInputRef={createRef<HTMLInputElement>() as React.RefObject<HTMLInputElement>}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "More options" }));
    }

    test.each([
        ["New chat", "onNewChat"],
        ["Mark all as read", "onMarkAllRead"],
        ["Select chats", "onSelect"],
        ["Archived chats", "onToggleArchived"],
        ["Refresh", "onRefresh"],
        ["Settings", "onOpenSettings"],
    ] as const)("%s invokes %s", (label, handler) => {
        const o = options();
        renderBar(o);
        fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }));
        expect(o[handler]).toHaveBeenCalledTimes(1);
    });

    test("shows the archived count and ignores disabled items", () => {
        const o = options({ canMarkAllRead: false });
        renderBar(o);
        expect(screen.getByRole("menuitem", { name: /Archived chats/ })).toHaveTextContent("Archived chats2");
        const markRead = screen.getByRole("menuitem", { name: "Mark all as read" });
        expect(markRead).toBeDisabled();
        fireEvent.click(markRead);
        expect(o.onMarkAllRead).not.toHaveBeenCalled();
    });
});

describe("ChatSidebar menu actions", () => {
    const conversations = [
        { id: 1, name: "Alice", unread_count: 3 },
        { id: 2, name: "Bob", unread_count: 0 },
        { id: 3, name: "Carol", unread_count: 1, is_muted: true },
        { id: 4, name: "Dave", unread_count: 2, is_archived: true },
    ];
    function renderSidebar(extra: Record<string, unknown> = {}) {
        const props = {
            conversations,
            activeConvId: null,
            search: "",
            setSearch: vi.fn(),
            searchResults: [],
            searching: false,
            typingUsers: {},
            onlineUsers: new Set(),
            convMenu: null,
            mobileView: "list",
            userId: 9,
            loadingConvs: false,
            onSearchUser: vi.fn(),
            onOpenConv: vi.fn(),
            onMenuToggle: vi.fn(),
            onPinConv: vi.fn(),
            onFavConv: vi.fn(),
            onDeleteConv: vi.fn(),
            onNewGroup: vi.fn(),
            onMarkAllRead: vi.fn(),
            onRefresh: vi.fn(),
            searchInputRef: createRef<HTMLInputElement>(),
            ...extra,
        };
        render(<ChatSidebar {...(props as any)} />);
        return props;
    }
    const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const pick = (name: RegExp | string) => fireEvent.click(screen.getByRole("menuitem", { name }));

    test("mark all as read targets visible unread chats; refresh reloads", () => {
        const props = renderSidebar();
        openMenu();
        pick("Mark all as read");
        expect(props.onMarkAllRead).toHaveBeenCalledWith([1, 3]);
        openMenu();
        pick("Refresh");
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
    });

    test("select chats enters selection mode with nothing selected and stays there", () => {
        renderSidebar();
        openMenu();
        pick("Select chats");
        expect(screen.getByText("0 selected")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
        expect(screen.queryByText("0 selected")).toBeNull();
    });

    test("archived chats toggles the archived view and back", () => {
        renderSidebar();
        openMenu();
        pick(/Archived chats/);
        expect(screen.getByText("Dave")).toBeInTheDocument();
        expect(screen.queryByText("Alice")).toBeNull();
        expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
        openMenu();
        pick("Back to chats");
        expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    test("settings opens the chat preferences modal", () => {
        renderSidebar();
        openMenu();
        pick("Settings");
        expect(screen.getByRole("dialog", { name: "Chat settings" })).toBeInTheDocument();
        fireEvent.click(screen.getByText("Done"));
        expect(screen.queryByRole("dialog", { name: "Chat settings" })).toBeNull();
    });

    test("new chat FAB opens people search and hides while searching", () => {
        renderSidebar();
        fireEvent.click(screen.getByRole("button", { name: "New chat" }));
        expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    });

    test("calls tab menu selects and refreshes the call list", async () => {
        mocks.getAllCallHistory.mockResolvedValue({
            data: [{ id: 7, caller_id: 9, other_name: "Eve", status: "completed", created_at: "2026-01-01T10:00:00Z" }],
            headers: {},
        });
        renderSidebar();
        fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
        expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
        await screen.findByText("Eve");
        openMenu();
        pick("Select calls");
        expect(screen.getByText("0 selected")).toBeInTheDocument();
        openMenu();
        pick("Refresh");
        await waitFor(() => expect(mocks.getAllCallHistory).toHaveBeenCalledTimes(2));
    });
});
