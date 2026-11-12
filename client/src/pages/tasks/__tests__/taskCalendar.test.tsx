import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import API from "../../../api/client";
import TaskCalendar from "../TaskCalendar";

vi.mock("../../../api/client", () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const span = { id: 1, ticket_key: "OPS-1", title: "Launch window", start_date: "2026-11-09", due_date: "2026-11-12",
    capabilities: { can: { edit: { allowed: true } } } };
const undated = { ...span, id: 2, ticket_key: "OPS-2", title: "Ready to plan", start_date: null, due_date: null };
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(API.get).mockImplementation(async (url: string, config: any) => ({ data: url.includes("schedule-overlays")
        ? { leave: [{ id: 1, date: "2026-11-10", user_name: "Alice", leave_type: "leave" }],
            holidays: [{ id: 1, date: "2026-11-11", name: "Holiday" }],
            meetings: [{ id: 1, start_time: "2026-11-12T10:00:00Z", title: "Launch review" }] }
        : { tasks: config?.params?.undated ? [undated] : [span] },
    }) as any);
    vi.mocked(API.put).mockResolvedValue({ data: span } as any);
});
function show(today = "2026-11-09") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenDetail = vi.fn();
    render(<QueryClientProvider client={client}><TaskCalendar project={{ id: 10 }} today={today} onOpenDetail={onOpenDetail} /></QueryClientProvider>);
    return onOpenDetail;
}

test("week view uses Monday-to-Sunday bounds across a year boundary with inclusive spans, overlays and undated work", async () => {
    vi.mocked(API.get).mockImplementation(async (url: string, config: any) => ({ data: url.includes("schedule-overlays")
        ? { leave: [{ id: 1, date: "2026-12-31", user_name: "Alice", leave_type: "leave" }],
            holidays: [{ id: 1, date: "2027-01-01", name: "New year" }],
            meetings: [{ id: 1, start_time: "2027-01-02T10:00:00Z", title: "Year review" }] }
        : { tasks: config?.params?.undated ? [undated] : [
            { ...span, start_date: "2026-12-27", due_date: "2027-01-02" },
            { ...span, id: 3, title: "Only a deadline", start_date: null, due_date: "2027-01-03" },
        ] },
    }) as any);
    show("2027-01-01");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByText("Ready to plan");
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(API.get).toHaveBeenCalledWith("/tasks", expect.objectContaining({ params: expect.objectContaining({
        start_date: "2026-12-28", end_date: "2027-01-03",
    }) }));
    expect(API.get).toHaveBeenCalledWith(expect.stringContaining("schedule-overlays"), expect.objectContaining({
        params: { from: "2026-12-28", to: "2027-01-03" },
    }));
    expect(screen.queryByRole("group", { name: "2026-12-27" })).toBeNull();
    expect(screen.queryByRole("group", { name: "2027-01-04" })).toBeNull();
    expect(screen.getAllByText("Launch window")).toHaveLength(6);
    expect(within(screen.getByRole("group", { name: "2027-01-03" })).getByText("Only a deadline")).toBeInTheDocument();
    expect(screen.getByText("Alice on leave")).toHaveAttribute("draggable", "false");
    expect(screen.getByText("New year")).toBeInTheDocument();
    expect(screen.getByText("Year review")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Holidays"));
    expect(screen.queryByText("New year")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("group", { name: "2027-01-04" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(screen.getByRole("group", { name: "2026-12-28" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByLabelText("Calendar month")).toHaveValue("2027-01");
});

test("calendar shows an inclusive span, undated tray and read-only leave, holiday and meeting context", async () => {
    const open = show();
    await screen.findByText("Ready to plan");
    for (const date of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
        expect(within(screen.getByRole("group", { name: date })).getByText("Launch window")).toBeInTheDocument();
    }
    expect(within(screen.getByRole("group", { name: "2026-11-13" })).queryByText("Launch window")).toBeNull();
    expect(screen.getByText("Alice on leave")).toHaveAttribute("draggable", "false");
    expect(screen.getByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("Launch review")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "2026-11-09" })).getByRole("button", { name: "Launch window" }));
    expect(open).toHaveBeenCalledWith(span);
    expect(API.get).toHaveBeenCalledWith("/tasks", expect.objectContaining({ params: expect.objectContaining({ scope: "calendar", project_id: 10, undated: "1" }) }));
});

test("week drag and keyboard edits share month date validation and keep the undated tray", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByText("Ready to plan");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(within(screen.getByRole("group", { name: "2026-11-10" })).getByRole("article"), { dataTransfer });
    fireEvent.drop(screen.getByRole("group", { name: "2026-11-14" }), { dataTransfer });
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/1", {
        start_date: "2026-11-13", due_date: "2026-11-16",
    }));
    await screen.findByText("Dates saved");
    fireEvent.click(within(screen.getByRole("group", { name: "2026-11-09" })).getByRole("button", { name: "Edit dates for OPS-1" }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Due date cannot be earlier than the start date");
    expect(API.put).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/1", { start_date: null, due_date: "2026-11-15" }));
    await screen.findByText("Dates saved");
    fireEvent.dragStart(within(screen.getByRole("complementary", { name: "Undated open tickets" })).getByRole("article"), { dataTransfer });
    fireEvent.drop(screen.getByRole("group", { name: "2026-11-15" }), { dataTransfer });
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/2", { start_date: "2026-11-15", due_date: "2026-11-15" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("group", { name: "2026-11-16" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("group", { name: "2026-11-09" })).toBeInTheDocument();
}, 20_000);

test("keyboard date edits refuse due-before-start locally, then persist both dates without placement", async () => {
    show();
    await screen.findByText("Ready to plan");
    fireEvent.click(within(screen.getByRole("group", { name: "2026-11-09" })).getByRole("button", { name: "Edit dates for OPS-1" }));
    expect(screen.getByLabelText("Start date")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Due date cannot be earlier than the start date");
    expect(API.put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/1", { start_date: "2026-11-09", due_date: "2026-11-15" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Dates saved");
});

test("dragging shifts a span together and dates undated work, without changing project or workflow", async () => {
    show();
    await screen.findByText("Ready to plan");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(within(screen.getByRole("group", { name: "2026-11-10" })).getByRole("article"), { dataTransfer });
    fireEvent.drop(screen.getByRole("group", { name: "2026-11-14" }), { dataTransfer });
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/1", { start_date: "2026-11-13", due_date: "2026-11-16" }));
    await screen.findByText("Dates saved");
    fireEvent.dragStart(within(screen.getByRole("complementary", { name: "Undated open tickets" })).getByRole("article"), { dataTransfer });
    fireEvent.drop(screen.getByRole("group", { name: "2026-11-14" }), { dataTransfer });
    await waitFor(() => expect(API.put).toHaveBeenCalledWith("/tasks/2", { start_date: "2026-11-14", due_date: "2026-11-14" }));
}, 20_000);

test("single-date tickets appear only on that day and server read-only capabilities disable dates and drag", async () => {
    vi.mocked(API.get).mockImplementation(async (url: string, config: any) => ({ data: url.includes("schedule-overlays") ? {} : {
        tasks: config?.params?.undated ? [] : [
            { ...span, start_date: null, due_date: "2026-11-09", capabilities: { can: { edit: { allowed: false, reason: "READ_ONLY_ROLE" } } } },
            { ...undated, start_date: "2026-11-11", capabilities: { can: { edit: { allowed: false, reason: "PROJECT_ARCHIVED" } } } },
        ],
    } }) as any);
    show();
    await screen.findByText("Ready to plan");
    const first = within(screen.getByRole("group", { name: "2026-11-09" }));
    const second = within(screen.getByRole("group", { name: "2026-11-11" }));
    expect(first.getByRole("button", { name: "Edit dates for OPS-1" })).toBeDisabled();
    expect(second.getByRole("button", { name: "Edit dates for OPS-2" })).toBeDisabled();
    expect(first.getByRole("article")).toHaveAttribute("draggable", "false");
    expect(screen.getAllByText("Launch window")).toHaveLength(1);
    expect(screen.getAllByText("Ready to plan")).toHaveLength(1);
    expect(API.put).not.toHaveBeenCalled();
}, 20_000);

test("a stale date refusal is explained and never optimistically moves the ticket", async () => {
    vi.mocked(API.put).mockRejectedValue({ response: { data: { error: "Due date cannot be earlier than the start date" } } });
    show();
    await screen.findByText("Ready to plan");
    fireEvent.click(within(screen.getByRole("group", { name: "2026-11-09" })).getByRole("button", { name: "Edit dates for OPS-1" }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Due date cannot be earlier than the start date");
    expect(within(screen.getByRole("group", { name: "2026-11-12" })).getByText("Launch window")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "2026-11-13" })).queryByText("Launch window")).toBeNull();
}, 20_000);
