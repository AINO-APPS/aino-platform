import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useState } from "react";
import CreateProjectPicker from "../CreateProjectPicker";
import { useCreateProjectSelection } from "../hooks/useCreateProjectSelection";
import { writeError } from "../ticketCapabilities";

const projects = [
    { id: 10, key: "ONE", name: "One", capabilities: { canCreateTickets: true } },
    { id: 20, key: "TWO", name: "Two", capabilities: { canCreateTickets: true } },
    { id: 30, key: "VIEW", name: "Viewer only", capabilities: { canCreateTickets: false } },
    { id: 40, key: "OLD", name: "Archived", is_archived: true, capabilities: { canCreateTickets: true } },
];
function Form({ currentProjectId, items = projects }: { currentProjectId?: number; items?: any[] }) {
    const [value, setValue] = useState("");
    const selection = useCreateProjectSelection({
        enabled: true, projects: items, currentProjectId, userKey: "org1.user1", value, onChange: setValue,
    });
    return <form onSubmit={event => { event.preventDefault(); selection.remember(); }}>
        <CreateProjectPicker projects={selection.projects} value={value} onChange={setValue} />
        <button type="submit" disabled={!value}>Create Ticket</button>
    </form>;
}
describe("create ticket project picker", () => {
    beforeEach(() => localStorage.clear());
    test("requires a project and defaults to the current project before the last used project", async () => {
        localStorage.setItem("tasks.lastCreateProjectId.org1.user1", "20");
        render(<Form currentProjectId={10} />);
        await waitFor(() => expect(screen.getByLabelText("Project")).toHaveValue("10"));
        expect(screen.getByLabelText("Project")).toBeRequired();
        expect(screen.queryByRole("option", { name: /Viewer only/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /Archived/ })).not.toBeInTheDocument();
    });
    test("remembers a successful selection and restores it when there is no current project", async () => {
        const first = render(<Form />);
        expect(screen.getByLabelText("Project")).toHaveValue("");
        fireEvent.change(screen.getByLabelText("Project"), { target: { value: "20" } });
        fireEvent.click(screen.getByRole("button", { name: "Create Ticket" }));
        first.unmount();
        render(<Form />);
        await waitFor(() => expect(screen.getByLabelText("Project")).toHaveValue("20"));
    });
    test("switching the project on screen changes the create default", async () => {
        const view = render(<Form currentProjectId={10} />);
        await waitFor(() => expect(screen.getByLabelText("Project")).toHaveValue("10"));
        view.rerender(<Form currentProjectId={20} />);
        await waitFor(() => expect(screen.getByLabelText("Project")).toHaveValue("20"));
    });
    test("a stale viewer-only default is cleared and an empty picker explains why creation is unavailable", async () => {
        localStorage.setItem("tasks.lastCreateProjectId.org1.user1", "30");
        render(<Form currentProjectId={40} items={projects.slice(2)} />);
        await waitFor(() => expect(screen.getByLabelText("Project")).toHaveValue(""));
        expect(screen.getByText(/No projects available/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Create Ticket" })).toBeDisabled();
    });
    test("project sprint mismatches have a clear message even when the API supplies only the code", () => {
        expect(writeError({ response: { data: { code: "SPRINT_PROJECT_MISMATCH" } } }, "Failed"))
            .toBe("The sprint belongs to another project.");
    });
});
