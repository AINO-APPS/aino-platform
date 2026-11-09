import IssueKey from "./IssueKey";
import s from "./PlanningSubtasks.module.css";

export default function PlanningSubtasks({ parent, subtasks, onOpenDetail }: {
    parent: any; subtasks: any[]; onOpenDetail: (ticket: any) => void;
}) {
    if (!subtasks.length) return null;
    return <ul className={s.subtasks} aria-label={`Subtasks of ${parent.title}`}>
        {subtasks.map(child => <li key={child.id} className={s.row}>
            <IssueKey task={child} copyable={false} />
            <button type="button" className={s.title} onClick={() => onOpenDetail(child)}>{child.title}</button>
            <span className={s.state}>{child.state_name ?? child.workflow_state_name}</span>
            {child.completed_at && <span className={s.state}>Done</span>}
        </li>)}
    </ul>;
}
