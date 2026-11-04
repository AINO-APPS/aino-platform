import { beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ProjectTasksPanel from "../ProjectTasksPanel";
import { REALTIME_EVENT } from "../../../hooks/useWebSocket";
import { ToastProvider } from "../../common/Toast";
import ProjectKeySettings from "../ProjectKeySettings";

const api = vi.hoisted(() => ({
  key: "OLD",
  getProjectTasks: vi.fn(),
  getProjectMembers: vi.fn(),
  previewProjectKeyRename: vi.fn(),
  renameProjectKey: vi.fn(),
}));
vi.mock("../../../api/tasks", () => ({
  getProjectTasks: (...args: any[]) => api.getProjectTasks(...args),
  getProjectMembers: (...args: any[]) => api.getProjectMembers(...args),
  previewProjectKeyRename: (...args: any[]) => api.previewProjectKeyRename(...args),
  renameProjectKey: (...args: any[]) => api.renameProjectKey(...args),
}));

function renderSettings(canRenameKey = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>
    <ProjectTasksPanel
      project={{ id: 10, key: "OLD", name: "Platform", key_published: true, capabilities: { canRenameKey } }}
      users={[]} teams={[]} onClose={vi.fn()}
    />
  </ToastProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.key = "OLD";
  api.getProjectTasks.mockImplementation(async () => ({
    data: { tasks: [{ id: 100, title: "First", ticket_key: `${api.key}-2`, issue_key: `${api.key}-2` }] },
  }));
  api.getProjectMembers.mockResolvedValue({ data: [] });
  api.previewProjectKeyRename.mockResolvedValue({
    data: { project_id: 10, old_key: "OLD", new_key: "NEW", affected_tickets: 2 },
  });
  api.renameProjectKey.mockImplementation(async () => {
    api.key = "NEW";
    return { data: { project_id: 10, old_key: "OLD", new_key: "NEW", affected_tickets: 2 } };
  });
});

test("project settings preview the affected count, warn, then refresh visible ticket keys after confirmation", async () => {
  const dispatch = vi.spyOn(window, "dispatchEvent");
  const user = userEvent.setup();
  renderSettings();
  expect(await screen.findByText("OLD-2")).toBeInTheDocument();
  await user.type(screen.getByLabelText("New project key"), "NEW");
  await user.click(screen.getByRole("button", { name: "Preview key rename" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("2 tickets");
  expect(screen.getByRole("alert")).toHaveTextContent("OLD");
  expect(screen.getByRole("alert")).toHaveTextContent("never be reused");
  expect(api.renameProjectKey).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm key rename" }));
  await waitFor(() => expect(api.renameProjectKey).toHaveBeenCalledWith(10, "NEW"));
  expect(await screen.findByText("NEW-2")).toBeInTheDocument();
  expect(screen.queryByText("OLD-2")).not.toBeInTheDocument();
  const event = dispatch.mock.calls.map(([event]) => event)
    .find(event => event.type === REALTIME_EVENT) as CustomEvent;
  expect(event.detail).toEqual({ type: "project_updated", data: { project_id: 10 } });
  dispatch.mockRestore();
});

test("rename controls are hidden without canRenameKey", async () => {
  renderSettings(false);
  expect(await screen.findByText("OLD-2")).toBeInTheDocument();
  expect(screen.queryByLabelText("New project key")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Preview key rename" })).not.toBeInTheDocument();
});

test("an open project list refreshes ticket keys when another admin renames", async () => {
  renderSettings(false);
  expect(await screen.findByText("OLD-2")).toBeInTheDocument();
  api.key = "NEW";
  await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, {
    detail: { type: "project_updated", data: { project_id: 10 } },
  })); });
  expect(await screen.findByText("NEW-2")).toBeInTheDocument();
});

test("editing a previewed key requires a new preview and server errors are shown without submitting", async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.type(screen.getByLabelText("New project key"), "NEW");
  await user.click(screen.getByRole("button", { name: "Preview key rename" }));
  expect(await screen.findByRole("button", { name: "Confirm key rename" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("New project key"), "ER");
  expect(screen.queryByRole("button", { name: "Confirm key rename" })).not.toBeInTheDocument();
  api.previewProjectKeyRename.mockRejectedValueOnce({ response: { data: { error: "Project key is reserved" } } });
  await user.click(screen.getByRole("button", { name: "Preview key rename" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Project key is reserved");
  expect(api.renameProjectKey).not.toHaveBeenCalled();
});

test("a later remote rename replaces the saved key and invalidates an open preview", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const panel = (key: string) => <QueryClientProvider client={client}>
    <ProjectKeySettings project={{ id: 10, key, capabilities: { canRenameKey: true } }} />
  </QueryClientProvider>;
  const view = render(panel("OLD"));
  await user.type(screen.getByLabelText("New project key"), "NEW");
  await user.click(screen.getByRole("button", { name: "Preview key rename" }));
  await user.click(await screen.findByRole("button", { name: "Confirm key rename" }));
  expect(await screen.findByRole("status")).toHaveTextContent("NEW");
  await user.type(screen.getByLabelText("New project key"), "NEXT");
  await user.click(screen.getByRole("button", { name: "Preview key rename" }));
  expect(await screen.findByRole("button", { name: "Confirm key rename" })).toBeInTheDocument();
  view.rerender(panel("REMOTE"));
  expect(screen.getByText("REMOTE")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm key rename" })).not.toBeInTheDocument();
});
