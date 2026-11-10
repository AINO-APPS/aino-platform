import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgileConfigProvider, useAgileConfig } from "../../../AgileConfigContext";
import { getAgileConfig } from "../../../api/tasks";

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 1, tenant_id: 1 } }),
    hasTenantContext: () => true,
}));
vi.mock("../../../api/tasks", () => ({
    getAgileConfig: vi.fn(async (projectId?: number) => ({ data: {
        workflowStates: [{ id: projectId ?? 1, key: "new", name: projectId === 20 ? "Second project" : "First project" }],
    } })),
}));
function Workflow() {
    const config = useAgileConfig();
    return <>
        <button onClick={() => config.setProjectScope(20)}>Switch project</button>
        <span>{config.workflowStates[0]?.name}</span>
    </>;
}
beforeEach(() => localStorage.clear());
test("the selected Plan project loads its own workflow instead of the default project's columns", async () => {
    render(<AgileConfigProvider><Workflow /></AgileConfigProvider>);
    await screen.findByText("First project");
    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    await screen.findByText("Second project");
    await waitFor(() => expect(getAgileConfig).toHaveBeenLastCalledWith(20));
});
