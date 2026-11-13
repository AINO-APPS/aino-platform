import { beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HierarchyRepairsReview from "../HierarchyRepairsReview";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../api/client", () => ({ default: api }));

beforeEach(() => {
  vi.resetAllMocks();
  const value = { parent_task_id: null, work_item_type_id: 3, project_id: 10, sprint_id: null, story_points: null };
  api.get.mockResolvedValue({ data: { hierarchy_repairs: [
    { task_id: 100, ticket_key: "ENG-1", stage: "original", reason: "Cleared legacy parent",
      repaired_at: "2026-11-09T10:00:00Z", before: { ...value, parent_task_id: 42 }, after: value },
    { task_id: 100, ticket_key: "ENG-1", stage: "correction", reason: "Recovered eligible leaf",
      repaired_at: "2026-11-11T10:00:00Z", before: value, after: { ...value, parent_task_id: 42, sprint_id: 7 } },
  ] } });
});

function show(role = "super_admin") {
  return render(<QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}><HierarchyRepairsReview role={role} /></QueryClientProvider>);
}

test("admins can review original repairs and corrections without ownership switch controls", async () => {
  const user = userEvent.setup();
  show();
  expect(api.get).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Review hierarchy repairs" }));
  expect(await screen.findByText("Cleared legacy parent")).toBeInTheDocument();
  expect(screen.getByText("Recovered eligible leaf")).toBeInTheDocument();
  expect(screen.getByText("Original repair")).toBeInTheDocument();
  expect(screen.getByText("Follow-up correction")).toBeInTheDocument();
  expect(screen.getByText("Sprint #7")).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/projects/hierarchy-repairs");
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /switch/i })).not.toBeInTheDocument();
});

test("non-admins cannot load hierarchy repairs", () => {
  show("hr_admin");
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Review hierarchy repairs" })).not.toBeInTheDocument();
});

test("a failed review is visible and retryable rather than shown as an empty audit", async () => {
  api.get.mockRejectedValueOnce(new Error("Unavailable"));
  const user = userEvent.setup();
  show("platform_admin");
  await user.click(screen.getByRole("button", { name: "Review hierarchy repairs" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load hierarchy repairs");
  expect(screen.queryByText("No hierarchy repairs were needed.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Recovered eligible leaf")).toBeInTheDocument();
});
