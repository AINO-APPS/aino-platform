import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import TaskHistoryList from "../TaskHistoryList";

test("Service Desk system history shows the sync and deletion note", () => {
    render(<TaskHistoryList history={[
        { id: 1, action: "service_desk_sync", full_name: "System", old_value: "pending",
            new_value: "in_progress", created_at: "2026-11-04T10:00:00Z" },
        { id: 2, action: "service_desk_deleted", full_name: "System",
            new_value: "Service Desk ticket #31 deleted; platform copy retained", created_at: "2026-11-04T11:00:00Z" },
    ]} />);
    expect(screen.getAllByText("System")).toHaveLength(2);
    expect(screen.getByText(/Service Desk sync/)).toBeTruthy();
    expect(screen.getByText("Service Desk ticket #31 deleted; platform copy retained")).toBeTruthy();
});
