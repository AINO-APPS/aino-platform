import React from "react";
import { CalendarDays } from "../../constants/icons";
import { formatDueDate, getAvatarUrl, isDueOverdue } from "./utils";
import s from "./TaskDetailModal.module.css";

interface TaskMetaGridProps {
    task: any;
    availableSprints: any[];
}

function Avatar({ user }: { user: any }) {
    if (user.avatar) {
        return <img src={getAvatarUrl(user.avatar)} alt="" className={s["detail-avatar"]} />;
    }
    return (
        <span className={s["detail-avatar-placeholder"]}>
            {(user.full_name || user.username || "?")[0].toUpperCase()}
        </span>
    );
}

/**
 * The task's metadata grid.
 *
 * Planned date and due date are deliberately separate fields with separate
 * explanations: the planned date is when the work is scheduled, the due date is
 * the deadline that drives overdue warnings and reminders.
 */
export default function TaskMetaGrid({ task, availableSprints }: TaskMetaGridProps) {
    const dueFmt = formatDueDate(task.due_date);
    const overdue = isDueOverdue(task.due_date) && !task.completed_at;
    // `planned_date` is the scheduling field; `date` is the legacy column the
    // server still mirrors it into until the contract migration lands.
    const plannedDate = task.planned_date || null;
    const sprintName = availableSprints.find((sp: any) => sp.id === task.sprint_id)?.name;

    return (
        <div className={s["detail-meta-grid"]}>
            <div className={s["detail-meta-item"]}>
                <span className={s["detail-meta-label"]}>Planned date</span>
                <span className={s["detail-meta-value"]}>
                    {plannedDate ? (
                        <>
                            <CalendarDays
                                size={12}
                                style={{ marginRight: 3, verticalAlign: "middle" }}
                            />
                            {plannedDate}
                        </>
                    ) : (
                        <span className={s["detail-meta-empty"]}>Not scheduled</span>
                    )}
                </span>
                <span className={s["detail-meta-hint"]}>
                    When this is scheduled to be worked on. Does not remove it from the
                    backlog.
                </span>
            </div>

            <div className={s["detail-meta-item"]}>
                <span className={s["detail-meta-label"]}>Due date</span>
                <span
                    className={`${s["detail-meta-value"]} ${overdue ? s["overdue"] : ""}`}
                >
                    {dueFmt ? (
                        <>
                            <CalendarDays
                                size={12}
                                style={{ marginRight: 3, verticalAlign: "middle" }}
                            />
                            {dueFmt}
                        </>
                    ) : (
                        <span className={s["detail-meta-empty"]}>No deadline</span>
                    )}
                </span>
                <span className={s["detail-meta-hint"]}>
                    The deadline. Drives overdue warnings and due-date reminders.
                </span>
            </div>

            {task.assignee && (
                <div className={s["detail-meta-item"]}>
                    <span className={s["detail-meta-label"]}>Assigned to</span>
                    <span className={s["detail-meta-value"]}>
                        <Avatar user={task.assignee} />
                        {task.assignee.full_name || task.assignee.username}
                    </span>
                </div>
            )}

            {task.creator && task.assigned_to && task.user_id !== task.assigned_to && (
                <div className={s["detail-meta-item"]}>
                    <span className={s["detail-meta-label"]}>Created by</span>
                    <span className={s["detail-meta-value"]}>
                        <Avatar user={task.creator} />
                        {task.creator.full_name || task.creator.username}
                    </span>
                </div>
            )}

            {task.created_at && (
                <div className={s["detail-meta-item"]}>
                    <span className={s["detail-meta-label"]}>Created</span>
                    <span className={s["detail-meta-value"]}>
                        {new Date(task.created_at).toLocaleString()}
                    </span>
                </div>
            )}

            {task.completed_at && (
                <div className={s["detail-meta-item"]}>
                    <span className={s["detail-meta-label"]}>Completed</span>
                    <span className={s["detail-meta-value"]}>
                        {new Date(task.completed_at).toLocaleString()}
                    </span>
                </div>
            )}

            {task.sprint_id && (
                <div className={s["detail-meta-item"]}>
                    <span className={s["detail-meta-label"]}>Sprint</span>
                    <span className={s["detail-meta-value"]}>
                        {sprintName || `Sprint #${task.sprint_id}`}
                    </span>
                </div>
            )}
        </div>
    );
}
