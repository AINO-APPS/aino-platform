import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHierarchyRepairs, type HierarchyRepairValue } from "../api/hierarchyRepairs";
import styles from "./HierarchyRepairsReview.module.css";

export default function HierarchyRepairsReview({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const allowed = role === "super_admin" || role === "platform_admin";
  const review = useQuery({
    queryKey: ["admin", "hierarchy-repairs"],
    queryFn: async () => (await getHierarchyRepairs()).data,
    enabled: allowed && open,
  });
  if (!allowed) return null;
  return <section className={styles.review} aria-labelledby="hierarchy-repairs-heading">
    <h2 id="hierarchy-repairs-heading">Hierarchy repairs</h2>
    <p>Read-only migration history. Original repairs and follow-up corrections remain available for review.</p>
    <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="hierarchy-repairs">
      {open ? "Hide hierarchy repairs" : "Review hierarchy repairs"}
    </button>
    {open && <div id="hierarchy-repairs">
      {review.isPending && <p role="status">Loading hierarchy repairs...</p>}
      {review.isError && <p role="alert">Could not load hierarchy repairs. <button onClick={() => void review.refetch()}>Try again</button></p>}
      {review.data && (review.data.hierarchy_repairs.length === 0 ? <p>No hierarchy repairs were needed.</p>
        : <div className={styles.tableScroll}><table>
          <caption>Hierarchy migration changes, oldest first. Identifiers describe the recorded change.</caption>
          <thead><tr><th>Ticket</th><th>Repair</th><th>Before</th><th>After</th><th>Recorded</th></tr></thead>
          <tbody>{review.data.hierarchy_repairs.map(repair => <tr key={`${repair.stage}-${repair.task_id}`}>
            <td><code>{repair.ticket_key || `#${repair.task_id}`}</code></td>
            <td><strong>{repair.stage === "original" ? "Original repair" : "Follow-up correction"}</strong><p>{repair.reason}</p></td>
            <td><RepairValue value={repair.before} /></td>
            <td><RepairValue value={repair.after} /></td>
            <td><time dateTime={repair.repaired_at}>{new Date(repair.repaired_at).toLocaleString()}</time></td>
          </tr>)}</tbody>
        </table></div>)}
    </div>}
  </section>;
}

function RepairValue({ value }: { value: HierarchyRepairValue }) {
  return <ul>
    <li>{value.parent_task_id == null ? "No parent" : `Parent #${value.parent_task_id}`}</li>
    <li>{value.work_item_type_id == null ? "No type" : `Type #${value.work_item_type_id}`}</li>
    <li>{value.project_id == null ? "No project" : `Project #${value.project_id}`}</li>
    <li>{value.sprint_id == null ? "No sprint" : `Sprint #${value.sprint_id}`}</li>
    <li>{value.story_points == null ? "No points" : `${value.story_points} points`}</li>
  </ul>;
}
