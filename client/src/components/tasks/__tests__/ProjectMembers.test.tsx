import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../../common/Toast";

const api = vi.hoisted(() => ({
  members: [] as any[],
  getProjectMembers: vi.fn(),
  grantProjectMember: vi.fn(),
  updateProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
}));

vi.mock("../../../api/tasks", () => ({
  getProjectMembers: (...args: any[]) => api.getProjectMembers(...args),
  grantProjectMember: (...args: any[]) => api.grantProjectMember(...args),
  updateProjectMember: (...args: any[]) => api.updateProjectMember(...args),
  removeProjectMember: (...args: any[]) => api.removeProjectMember(...args),
}));

import ProjectMembers from "../ProjectMembers";

function renderMembers(canManageMembers = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ProjectMembers
          projectId={10}
          canManageMembers={canManageMembers}
          users={[{ id: 2, full_name: "Mina Member" }]}
          teams={[{ id: 4, name: "Platform" }]}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.members = [{ id: 1, user_id: 1, user_name: "Ari Admin", role: "project_admin" }];
  api.getProjectMembers.mockReset().mockImplementation(async () => ({ data: api.members }));
  api.grantProjectMember.mockReset().mockResolvedValue({ data: {} });
  api.updateProjectMember.mockReset().mockResolvedValue({ data: {} });
  api.removeProjectMember.mockReset().mockResolvedValue({ data: {} });
});

describe("Project Members controls", () => {
  test("adds a person grant and removes an existing grant", async () => {
    const user = userEvent.setup();
    renderMembers();

    await user.selectOptions(await screen.findByLabelText("Person"), "2");
    await user.selectOptions(screen.getByLabelText("New member role"), "viewer");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(api.grantProjectMember).toHaveBeenCalledWith(10, {
      subject_type: "user", subject_id: 2, role: "viewer",
    }));

    await user.click(screen.getByRole("button", { name: "Remove Ari Admin" }));
    await waitFor(() => expect(api.removeProjectMember).toHaveBeenCalledWith(10, 1));
  });

  test("adds a team grant", async () => {
    const user = userEvent.setup();
    renderMembers();

    await user.selectOptions(screen.getByLabelText("Member type"), "team");
    await user.selectOptions(await screen.findByLabelText("Team"), "4");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(api.grantProjectMember).toHaveBeenCalledWith(10, {
      subject_type: "team", subject_id: 4, role: "member",
    }));
  });

  test("hides mutation controls without the project capability", async () => {
    renderMembers(false);

    expect(await screen.findByText("Ari Admin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Ari Admin" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Role for Ari Admin")).not.toBeInTheDocument();
  });
});
