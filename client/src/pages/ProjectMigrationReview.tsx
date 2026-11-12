import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMigrationReview, switchBackToTeams, switchToProjects, type MigrationProject } from "../api/projectMigration";
import { renameProjectKey } from "../api/tasks";
import styles from "./ProjectMigrationReview.module.css";
import HierarchyRepairsReview from "./HierarchyRepairsReview";

export function ProjectMigrationReviewLauncher({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  if (role !== "super_admin" && role !== "platform_admin") return null;
  return <div>
    <button onClick={() => setOpen(!open)} aria-expanded={open}>Review project migration</button>
    {open && <ProjectMigrationReview role={role} />}
  </div>;
}

export default function ProjectMigrationReview({ role }: { role: string }) {
  const allowed = role === "super_admin" || role === "platform_admin";
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"publish" | "rollback" | null>(null);
  const review = useQuery({
    queryKey: ["admin", "project-migration"],
    queryFn: async () => (await getMigrationReview()).data,
    enabled: allowed,
  });
  if (!allowed) return null;

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirmation(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin", "project-migration"] }),
        client.invalidateQueries({ queryKey: ["admin", "projects"] }),
        client.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (e: any) {
      setError(e.response?.data?.error || "Could not update project ownership. Please refresh and try again.");
    } finally { setBusy(false); }
  }

  return <section className={styles.review} aria-labelledby="migration-heading">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>OWNERSHIP / MIGRATION REVIEW</p>
        <h2 id="migration-heading">One final check. Then projects.</h2>
        <p>Review generated keys and access before publishing them to your organization.</p>
      </div>
      <span className={styles.badge}>{review.data?.project_ownership ? "Project visibility" : "Team visibility"}</span>
    </header>
    {review.isPending && <p role="status">Loading migration review…</p>}
    {(error || review.isError) && <p role="alert">{error || "Could not load migration review."}</p>}
    {review.data && <>
      <p>Unpublished keys can be renamed without aliases. Published keys retain every former key as an alias.</p>
      <div className={styles.projects}>
        {review.data.projects.map(project => <ProjectRow key={project.id} project={project} busy={busy}
          rename={key => mutate(() => renameProjectKey(project.id, key))} />)}
      </div>
      <h3>Migration moves <span className={styles.count}>{review.data.moves.length}</span></h3>
      <div className={styles.tableScroll}>
        <table>
          <caption className={styles.caption}>Tickets reassigned during migration. New keys reflect review renames.</caption>
          <thead><tr><th>Ticket</th><th>Old key</th><th>New key</th><th>Sprint</th></tr></thead>
          <tbody>{review.data.moves.map(move => <tr key={move.task_id}>
            <td>#{move.task_id}</td><td><code>{move.old_key || "No previous key"}</code></td>
            <td><code>{move.new_key}</code></td><td>{move.sprint_name || "No sprint"}</td>
          </tr>)}</tbody>
        </table>
        {review.data.moves.length === 0 && <p>No tickets were moved between projects.</p>}
      </div>
      <HierarchyRepairsReview repairs={review.data.hierarchy_repairs ?? []} />
      <footer className={styles.footer}>
        <p>{review.data.switched_at
          ? "Keys have been published. The initial switch cannot be repeated, even after an emergency rollback."
          : "Publishing is a one-time action. Team visibility stays in place until you confirm."}</p>
        {role === "super_admin" && !review.data.switched_at && !review.data.project_ownership &&
          <button disabled={busy || review.isFetching} onClick={() => setConfirmation("publish")}>Switch to projects</button>}
        {role === "platform_admin" && review.data.project_ownership &&
          <button disabled={busy || review.isFetching} onClick={() => setConfirmation("rollback")}>Emergency switch back to teams</button>}
      </footer>
    </>}
    {confirmation && <div role="alertdialog" aria-labelledby="switch-title" className={styles.confirmation}>
      <h3 id="switch-title">{confirmation === "publish" ? "Publish keys and switch visibility?" : "Restore team visibility?"}</h3>
      <p>{confirmation === "publish"
        ? "Every project key will be published and project grants will control visibility. Only a platform admin can switch back."
        : "Visibility will come from ticket teams again. Keys stay published. This emergency action is audited."}</p>
      <div className={styles.actions}>
        <button autoFocus disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
        <button disabled={busy} onClick={() => void mutate(confirmation === "publish" ? switchToProjects : switchBackToTeams)}>
          {busy ? "Applying…" : "Confirm switch"}
        </button>
      </div>
    </div>}
  </section>;
}

function ProjectRow({ project, busy, rename }: {
  project: MigrationProject; busy: boolean; rename: (key: string) => Promise<void>;
}) {
  const [key, setKey] = useState(project.key);
  return <article className={styles.project}>
    <div><h3>{project.name}</h3><p>{project.type.replace("_", " ")} · {project.ticket_count} tickets</p>
      <span className={styles.badge}>{project.key_published ? "Published" : "Unpublished"}</span></div>
    <form className={styles.actions} onSubmit={event => { event.preventDefault(); void rename(key); }}>
      <label>Project key<input aria-label={`Project key for ${project.name}`} value={key} maxLength={10}
        pattern="[A-Z][A-Z0-9_]{1,9}" required disabled={busy}
        onChange={event => setKey(event.target.value.toUpperCase())} /></label>
      <button disabled={busy || key === project.key} aria-label={`Save key for ${project.name}`}>Save key</button>
    </form>
    <ul className={styles.grants}>{project.grants.map((grant, index) =>
      <li key={index}>{grant.name || `User ${grant.user_id ?? grant.team_id}`} · {grant.role}</li>)}</ul>
  </article>;
}
