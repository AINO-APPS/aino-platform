import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectMigrationReview from "../ProjectMigrationReview";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api }));

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ data: {
    project_ownership: false, switched_at: null,
    projects: [{ id: 10, key: "ENG", name: "Engineering", type: "scrum", key_published: false,
      ticket_count: 7, grants: [{ team_id: 2, user_id: null, role: "member", name: "Builders" }] }],
    moves: [{ task_id: 100, old_key: "OLD-1", new_key: "ENG-1", migration_key: "ENG-1",
      sprint_id: 9, sprint_name: "November" }],
  } });
  api.post.mockResolvedValue({ data: {} });
});
function show(role = "super_admin") {
  return render(<QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}><ProjectMigrationReview role={role} /></QueryClientProvider>);
}

test("review shows generated projects and moves, saves inline rename and confirms before switching", async () => {
  const user = userEvent.setup();
  show();
  expect(await screen.findByText("Engineering")).toBeInTheDocument();
  expect(screen.getByText(/7 tickets/)).toBeInTheDocument();
  expect(screen.getByText("Builders · member")).toBeInTheDocument();
  expect(screen.getByText("OLD-1")).toBeInTheDocument();
  expect(screen.getByText("ENG-1")).toBeInTheDocument();
  expect(screen.getByText("November")).toBeInTheDocument();
  expect(screen.getByText("Unpublished")).toBeInTheDocument();
  const input = screen.getByLabelText("Project key for Engineering");
  await user.clear(input);
  await user.type(input, "BUILD");
  await user.click(screen.getByRole("button", { name: "Save key for Engineering" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/projects/10/key", { key: "BUILD" }));
  await user.click(screen.getByRole("button", { name: "Switch to projects" }));
  expect(api.post).not.toHaveBeenCalledWith("/projects/migration/switch");
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Every project key will be published");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Switch to projects" }));
  await user.click(screen.getByRole("button", { name: "Confirm switch" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/projects/migration/switch"));
}, 30_000);

test("non-admins cannot load review data and previously published orgs cannot switch again", async () => {
  const view = show("hr_admin");
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Switch to projects" })).not.toBeInTheDocument();
  view.unmount();
  api.get.mockResolvedValue({ data: {
    project_ownership: false, switched_at: "2026-11-04T10:00:00Z", projects: [], moves: [],
  } });
  show();
  expect(await screen.findByText(/initial switch cannot be repeated/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Switch to projects" })).not.toBeInTheDocument();
});

test("platform admins confirm emergency rollback and failed writes preserve the review with an error", async () => {
  api.get.mockResolvedValue({ data: {
    project_ownership: true, switched_at: "2026-11-04T10:00:00Z", projects: [], moves: [],
  } });
  api.post.mockRejectedValueOnce({ response: { data: { error: "Audit unavailable" } } });
  const user = userEvent.setup();
  show("platform_admin");
  await user.click(await screen.findByRole("button", { name: "Emergency switch back to teams" }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Keys stay published");
  await user.click(screen.getByRole("button", { name: "Confirm switch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Audit unavailable");
  expect(api.post).toHaveBeenCalledWith("/projects/migration/switch-back");
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
}, 30_000);
