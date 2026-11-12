import type { HierarchyRepair, HierarchyRepairValue } from "../api/projectMigration";
import styles from "./ProjectMigrationReview.module.css";

export default function HierarchyRepairsReview({ repairs }: { repairs: HierarchyRepair[] }) {
  return <section aria-labelledby="hierarchy-repairs-heading">
    <h3 id="hierarchy-repairs-heading">Hierarchy repairs <span aria-hidden="true" className={styles.count}>{repairs.length}</span></h3>
    <p>Original repairs and follow-up corrections are retained together. These records never change ticket history.</p>
    {repairs.length === 0 ? <p>No hierarchy repairs were needed.</p> : <div className={styles.tableScroll}>
      <table>
        <caption className={styles.caption}>Hierarchy migration changes, oldest first. Identifiers describe the recorded change.</caption>
        <thead><tr><th>Ticket</th><th>Repair</th><th>Before</th><th>After</th><th>Recorded</th></tr></thead>
        <tbody>{repairs.map(repair => <tr key={`${repair.stage}-${repair.task_id}`}>
          <td><code>{repair.ticket_key || `#${repair.task_id}`}</code></td>
          <td><strong>{repair.stage === "original" ? "Original repair" : "Follow-up correction"}</strong><p>{repair.reason}</p></td>
          <td><RepairValue value={repair.before} /></td>
          <td><RepairValue value={repair.after} /></td>
          <td><time dateTime={repair.repaired_at}>{new Date(repair.repaired_at).toLocaleString()}</time></td>
        </tr>)}</tbody>
      </table>
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
