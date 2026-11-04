import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, X } from "../constants/icons";
import {
  createProjectWorkflowState,
  deleteProjectWorkflowState,
  getProjectWorkflow,
  updateProjectWorkflowState,
  updateProjectWorkflowTransitions,
} from "../api/tasks";
import s from "./AgileSettings.module.css";

const CATEGORIES = [
  { key: "open", label: "Open / To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "in_review", label: "In Review" },
  { key: "done", label: "Done" },
];

interface ProjectWorkflowSettingsProps {
  project: any;
  onClose: () => void;
}

export default function ProjectWorkflowSettings({ project, onClose }: ProjectWorkflowSettingsProps) {
  const projectId = Number(project.id);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newState, setNewState] = useState({ name: "", category: "open", color: "#6b7280", is_initial: false });
  const [edges, setEdges] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  const queryKey = ["project", projectId, "workflow"];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => (await getProjectWorkflow(projectId)).data,
    enabled: !!project.capabilities?.canEditWorkflow,
  });
  const states: any[] = data?.workflowStates ?? [];
  const transitions: any[] = data?.transitions ?? [];
  const transitionKeys = useMemo(
    () => edges ?? new Set(transitions.map((edge) => `${edge.from_state_id}:${edge.to_state_id}`)),
    [edges, transitions],
  );

  if (!project.capabilities?.canEditWorkflow || data?.canEditWorkflow === false) return null;

  async function refresh() {
    setEdges(null);
    await queryClient.invalidateQueries({ queryKey });
  }

  async function saveState(stateId: number, patch: Record<string, unknown>) {
    setError("");
    try {
      await updateProjectWorkflowState(projectId, stateId, patch);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.error || "Failed to update workflow state");
    }
  }

  async function addState(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await createProjectWorkflowState(projectId, newState);
      setNewState({ name: "", category: "open", color: "#6b7280", is_initial: false });
      setAdding(false);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.error || "Failed to create workflow state");
    }
  }

  async function removeState(state: any) {
    if (!window.confirm(`Delete "${state.name}" from ${project.name}?`)) return;
    setError("");
    try {
      await deleteProjectWorkflowState(projectId, state.id);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.error || "Failed to delete workflow state");
    }
  }

  function toggleEdge(fromId: number, toId: number, enabled: boolean) {
    const next = new Set(transitionKeys);
    const key = `${fromId}:${toId}`;
    if (enabled) next.add(key);
    else next.delete(key);
    setEdges(next);
  }

  async function saveTransitions() {
    setError("");
    try {
      const saved = [...transitionKeys].map((edge) => {
        const [from_state_id, to_state_id] = edge.split(":").map(Number);
        return { from_state_id, to_state_id };
      });
      await updateProjectWorkflowTransitions(projectId, saved);
      await refresh();
    } catch (e: any) {
      setError(e.response?.data?.error || "Failed to save transitions");
    }
  }

  return (
    <div style={overlay} role="presentation">
      <section style={dialog} role="dialog" aria-modal="true" aria-labelledby="project-workflow-title">
        <header style={header}>
          <div>
            <h2 id="project-workflow-title" className={s.sectionTitle}>Workflow · {project.name}</h2>
            <p className={s.helpText}>Changes affect {project.key} only. Cancelled remains a terminal state.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close workflow settings" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {error && <div className={s.error} role="alert">{error}</div>}
        {isLoading ? <div className={s.loading}>Loading workflow…</div> : (
          <>
            <div className={s.sectionHead}>
              <h3 className={s.sectionTitle}>States</h3>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding((value) => !value)}>
                <Plus size={13} /> {adding ? "Cancel" : "Add State"}
              </button>
            </div>
            {adding && (
              <form className={s.inlineForm} onSubmit={addState}>
                <input required aria-label="State name" placeholder="State name" value={newState.name}
                  onChange={(event) => setNewState({ ...newState, name: event.target.value })} />
                <select aria-label="State category" value={newState.category}
                  onChange={(event) => setNewState({ ...newState, category: event.target.value })}>
                  {CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                </select>
                <input type="color" aria-label="State color" value={newState.color}
                  onChange={(event) => setNewState({ ...newState, color: event.target.value })} />
                <label><input type="checkbox" checked={newState.is_initial}
                  onChange={(event) => setNewState({ ...newState, is_initial: event.target.checked })} /> Initial</label>
                <button className="btn btn-primary btn-sm" type="submit">Create</button>
              </form>
            )}
            <div style={tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Name</th><th>Category</th><th>Color</th><th>WIP</th><th>Initial</th><th>Terminal</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {states.map((state) => (
                    <tr key={state.id}>
                      <td><input aria-label={`${state.name} name`} defaultValue={state.name} disabled={state.key === "cancelled"}
                        onBlur={(event) => event.target.value !== state.name && saveState(state.id, { name: event.target.value })} /></td>
                      <td><select aria-label={`${state.name} category`} value={state.category} disabled={state.key === "cancelled"}
                        onChange={(event) => saveState(state.id, { category: event.target.value })}>
                        {CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                      </select></td>
                      <td><input type="color" aria-label={`${state.name} color`} value={state.color}
                        onChange={(event) => saveState(state.id, { color: event.target.value })} /></td>
                      <td><input type="number" min="0" aria-label={`${state.name} WIP limit`} defaultValue={state.wip_limit ?? ""}
                        onBlur={(event) => saveState(state.id, { wip_limit: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                      <td><input type="checkbox" aria-label={`${state.name} initial`} checked={!!state.is_initial}
                        disabled={state.key === "cancelled"} onChange={(event) => saveState(state.id, { is_initial: event.target.checked })} /></td>
                      <td><input type="checkbox" aria-label={`${state.name} terminal`} checked={!!state.is_terminal}
                        disabled={state.key === "cancelled"} onChange={(event) => saveState(state.id, { is_terminal: event.target.checked })} /></td>
                      <td><input type="checkbox" aria-label={`${state.name} active`} checked={!!state.is_active}
                        disabled={state.key === "cancelled"} onChange={(event) => saveState(state.id, { is_active: event.target.checked })} /></td>
                      <td>{state.key !== "cancelled" && <button className="btn btn-danger btn-sm" aria-label={`Delete ${state.name}`}
                        onClick={() => removeState(state)}><Trash2 size={13} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={s.sectionHead}>
              <div>
                <h3 className={s.sectionTitle}>Allowed transitions</h3>
                <p className={s.helpText}>Cancelled has no outgoing transitions; Done must be reopened before it can be cancelled.</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={saveTransitions}><Save size={13} /> Save transitions</button>
            </div>
            <div style={tableWrap}>
              <table className={s.table}>
                <thead><tr><th>From / to</th>{states.filter((state) => state.is_active).map((state) => <th key={state.id}>{state.name}</th>)}</tr></thead>
                <tbody>
                  {states.filter((state) => state.is_active).map((from) => (
                    <tr key={from.id}>
                      <th>{from.name}</th>
                      {states.filter((state) => state.is_active).map((to) => {
                        const key = `${from.id}:${to.id}`;
                        const checked = transitionKeys.has(key);
                        const disabled = from.id === to.id || from.key === "cancelled" ||
                          (to.key === "cancelled" && (from.category === "done" || from.is_terminal));
                        return <td key={to.id}><input type="checkbox" aria-label={`${from.name} to ${to.name}`}
                          checked={checked} disabled={disabled} onChange={(event) => toggleEdge(from.id, to.id, event.target.checked)} /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15, 23, 42, .58)",
  display: "grid", placeItems: "center", padding: 20,
};
const dialog: React.CSSProperties = {
  width: "min(1100px, 100%)", maxHeight: "min(90vh, 900px)", overflow: "auto",
  background: "var(--surface, #fff)", borderRadius: 16, padding: 24,
  boxShadow: "0 24px 80px rgba(0,0,0,.24)",
};
const header: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 20 };
const tableWrap: React.CSSProperties = { overflowX: "auto", margin: "16px 0 24px" };
