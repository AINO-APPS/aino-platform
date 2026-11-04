import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { previewProjectKeyRename, renameProjectKey, type ProjectKeyRenameResult } from "../../api/tasks";
import { REALTIME_EVENT } from "../../hooks/useWebSocket";
import styles from "./ProjectKeySettings.module.css";

export default function ProjectKeySettings({ project }: { project: any }) {
  const client = useQueryClient();
  const [key, setKey] = useState("");
  const [preview, setPreview] = useState<ProjectKeyRenameResult | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSavedKey(null);
    setPreview(null);
  }, [project.key]);
  if (!project.capabilities?.canRenameKey) return null;

  async function submit(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      if (!confirm) {
        setPreview((await previewProjectKeyRename(project.id, key)).data);
      } else {
        if (!preview || preview.new_key !== key) return;
        const { data } = await renameProjectKey(project.id, preview.new_key);
        setSavedKey(data.new_key);
        setPreview(null);
        setKey("");
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { type: "project_updated", data } }));
        await Promise.all([
          client.invalidateQueries({ queryKey: ["admin", "projects"] }),
          client.invalidateQueries({ queryKey: ["admin", "project-tasks", project.id] }),
        ]);
      }
    } catch (err: any) {
      setPreview(null);
      setError(err.response?.data?.error || "Could not rename project key. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.section} aria-label="Project key settings">
    <header className={styles.header}>
      <strong>Project key</strong>
      <code className={styles.key}>{savedKey ?? project.key}</code>
    </header>
    <p className={styles.hint}>Rename the prefix used by every ticket in this project.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(false); }} className={styles.form}>
      <label htmlFor={`project-key-${project.id}`}>New project key</label>
      <div className={styles.controls}>
        <input id={`project-key-${project.id}`} value={key} maxLength={10} required
          pattern="[A-Z][A-Z0-9_]{1,9}" placeholder="e.g. PLATFORM" disabled={busy}
          aria-describedby={`project-key-help-${project.id}`}
          onChange={event => { setKey(event.target.value.toUpperCase()); setPreview(null); setError(""); }} />
        <button type="submit" disabled={busy || !key || key === (savedKey ?? project.key)}>
          {busy ? "Working…" : "Preview key rename"}
        </button>
      </div>
      <small id={`project-key-help-${project.id}`} className={styles.hint}>
        2–10 uppercase letters, digits or underscores; start with a letter.
      </small>
    </form>
    {preview && <div role="alert" className={styles.warning}>
      <strong>{preview.affected_tickets} {preview.affected_tickets === 1 ? "ticket" : "tickets"} will get a new key.</strong>
      <p><code>{preview.old_key}</code> → <code>{preview.new_key}</code>. All tickets change together.
        {" "}The old project key can never be reused.
        {" "}{project.key_published === false
          ? "This key is unpublished, so no ticket aliases will be created."
          : "Old ticket links will keep opening the same tickets through aliases."}</p>
      <div className={styles.controls}>
        <button type="button" disabled={busy} onClick={() => void submit(true)}>Confirm key rename</button>
        <button type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
      </div>
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {savedKey && <p role="status">Project key renamed to <code>{savedKey}</code>.</p>}
  </section>;
}
