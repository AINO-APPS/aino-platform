import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import { bulkTaskAction } from "../../../api/tasks";
import { describeSkipped, useBulkSelection } from "../hooks/useBulkSelection";

vi.mock("../../../api/tasks", () => ({ bulkTaskAction: vi.fn() }));

test("bulk writes send only allowed tickets and show each skipped ticket's shared reason copy", async () => {
    const denied = {
        ...ticket, id: 43, title: "Frozen ticket",
        capabilities: { ...ticket.capabilities, can: { ...ticket.capabilities.can, delete: { allowed: false, reason: "SPRINT_FROZEN" } } },
    };
    vi.mocked(bulkTaskAction).mockResolvedValue({ data: { changed: 1, results: [{ id: 42, ok: true, task: ticket }] } } as any);
    const onApplied = vi.fn();
    const { result } = renderHook(() => useBulkSelection({ tasks: [ticket, denied], onApplied }));
    act(() => result.current.selectAll([42, 43]));
    await act(() => result.current.apply("delete", null));
    expect(bulkTaskAction).toHaveBeenCalledWith({ ids: [42], action: "delete", value: null });
    const results = onApplied.mock.calls[0][2];
    expect(results).toContainEqual({ id: 43, ok: false, code: "SPRINT_FROZEN" });
    expect(describeSkipped(results, [ticket, denied])).toContain("Frozen ticket: This sprint is frozen. Move the ticket out first.");
});
