import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createProject, updateProject, getProjectTypes } from "../api/tasks";
import { useToast } from "../components/common/Toast";
import { X } from "../constants/icons";
import { ProjectTypeControl, type ProjectType } from "../components/tasks/ProjectTypeControl";
const KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;
const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
];

interface ProjectFormProps {
  styles: Record<string, any>;
  project: any;
  users: any[];
  teams: any[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ProjectForm({ styles, project, users, teams, onClose, onSaved }: ProjectFormProps) {
  const toast = useToast() as any;
  const isEdit = !!project;
  const [name, setName] = useState(project?.name || "");
  const [keyValue, setKeyValue] = useState(project?.key || "");
  const [description, setDescription] = useState(project?.description || "");
  const [color, setColor] = useState(project?.color || COLORS[0]);
  const [leadId, setLeadId] = useState(project?.lead_user_id || "");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const { data: options } = useQuery({ queryKey: ["projects", "types"], queryFn: async () => (await getProjectTypes()).data });
  const [type, setType] = useState<ProjectType>(project?.type ?? "task_list");
  const [typeError, setTypeError] = useState("");
  useEffect(() => { if (!project && options) setType(options.defaultType); }, [project, options]);
  const [saving, setSaving] = useState(false);

  const keyValid = useMemo(
    () => isEdit || KEY_RE.test(keyValue),
    [keyValue, isEdit],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!isEdit && !keyValid) {
      toast.error(
        "Key must be 2–10 uppercase letters/digits/underscores, starting with a letter.",
      );
      return;
    }
    const payload: any = {
      name: name.trim(),
      type,
      description: description.trim() || null,
      color,
      lead_user_id: leadId || null,
    };
    if (!isEdit) payload.key = keyValue.trim().toUpperCase();
    if (!isEdit) payload.team_ids = teamIds.map(Number);
    try {
      setSaving(true);
      if (isEdit) await updateProject(project.id, payload);
      else await createProject(payload);
      toast.success(isEdit ? "Project updated" : "Project created");
      onSaved();
    } catch (err: any) {
      const message = err.response?.data?.error || "Save failed";
      setTypeError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>
            {isEdit ? `Edit ${project.key}` : "New project"}
          </h2>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <form onSubmit={onSubmit} style={styles.form}>
          <label style={styles.label}>
            <span>Name</span>
            <input
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website Rewrite"
              maxLength={200}
              autoFocus
              required
            />
          </label>
          {!isEdit && (
            <label style={styles.label}>
              <span>Key</span>
              <input
                style={{
                  ...styles.input,
                  fontFamily: "monospace",
                  textTransform: "uppercase",
                }}
                value={keyValue}
                onChange={(e) =>
                  setKeyValue(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                  )
                }
                placeholder="WEB"
                maxLength={10}
                required
              />
              <small style={styles.hint}>
                2–10 chars, uppercase letters/digits/underscores. Used in
                branches:{" "}
                <code style={styles.codeSm}>
                  feature/{keyValue || "WEB"}-123-…
                </code>
                . Cannot be changed later.
              </small>
              {keyValue && !keyValid && (
                <small style={{ ...styles.hint, color: "#ef4444" }}>
                  Must start with a letter; only A–Z, 0–9, and underscores.
                </small>
              )}
              {!isEdit && (
                <label style={styles.label}>
                  <span>Grant member access to teams</span>
                  <select
                    style={styles.input}
                    aria-label="Grant member access to teams"
                    multiple
                    value={teamIds}
                    onChange={(event) => setTeamIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                  <small style={styles.hint}>Hold Ctrl or Command to select more than one team.</small>
                </label>
              )}
            </label>
          )}
          <ProjectTypeControl value={type} availableTypes={project?.availableTypes ?? options?.availableTypes ?? []}
            changeableTypes={project?.changeableTypes} canChangeType={!isEdit || project.capabilities?.canChangeType === true}
            onChange={(value) => { setType(value); setTypeError(""); }} error={typeError} />
          <label style={styles.label}>
            <span>Description</span>
            <textarea
              style={{ ...styles.input, minHeight: 70, resize: "vertical" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional: what this project is about."
              maxLength={2000}
            />
          </label>
          <label style={styles.label}>
            <span>Lead</span>
            <select
              style={styles.input}
              value={leadId || ""}
              onChange={(e) => setLeadId(e.target.value)}
            >
              <option value="">— None —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.username}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            <span>Colour</span>
            <div style={styles.colors}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  style={{
                    ...styles.colorChip,
                    background: c,
                    outline:
                      c === color ? `2px solid var(--accent, #2383e2)` : "none",
                  }}
                />
              ))}
            </div>
          </label>
          <footer style={styles.modalFooter}>
            <button type="button" style={styles.secondaryBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" style={styles.primaryBtn} disabled={saving || (!isEdit && !options)}>
              {saving ? "Saving…" : isEdit ? "Save" : "Create"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

