import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import OrgSettings from "../OrgSettings";
import { updateOrgSettings } from "../../../api/organization";
import { getProjects } from "../../../api/tasks";

vi.mock("../../../api/organization", () => ({ updateOrgSettings: vi.fn() }));
vi.mock("../../../api/tasks", () => ({ getProjects: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjects).mockResolvedValue({ data: [
        { id: 21, key: "SUP", name: "Support", is_archived: false },
        { id: 22, key: "OLD", name: "Archived", is_archived: true },
    ] } as any);
    vi.mocked(updateOrgSettings).mockResolvedValue({ data: {} } as any);
}, 30_000);

test("admin saves an active Service Desk project and can restore the General fallback", async () => {
    const onUpdate = vi.fn();
    render(<OrgSettings org={{
        name: "Platform", timezone: "UTC", work_hours_per_day: 8, fiscal_year_start: 1,
        service_desk_project_id: null,
    }} userRole="super_admin" onUpdate={onUpdate} />);
    const picker = await screen.findByRole("combobox", { name: "Service Desk project" });
    await screen.findByRole("option", { name: "SUP · Support" });
    expect(screen.queryByRole("option", { name: /Archived/ })).toBeNull();
    fireEvent.change(picker, { target: { value: "21" } });
    fireEvent.submit(picker.closest("form")!);
    await waitFor(() => expect(updateOrgSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ service_desk_project_id: 21 }),
    ));
    fireEvent.change(picker, { target: { value: "" } });
    fireEvent.submit(picker.closest("form")!);
    await waitFor(() => expect(updateOrgSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ service_desk_project_id: null }),
    ));
    expect(onUpdate).toHaveBeenCalledTimes(2);
}, 30_000);
