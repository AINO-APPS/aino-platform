import React from "react";
import {
    Ban as GlyphBan,
    CheckSquare as InlineCheckSquare,
    Square as InlineSquare,
} from "../../constants/icons";
import {
    StoryPointBadge,
    WorkItemTypeBadge,
    BlockerBadge,
} from "../../components/agile/AgilePickers";
import { CustomFieldsSummary } from "../../components/customFields/CustomFieldRenderer";
import { HighlightedHtml } from "./utils";
import TaskMetaGrid from "./TaskMetaGrid";
import TaskStatusControl from "./TaskStatusControl";
import TaskTimePanel from "./TaskTimePanel";
import TaskGitRefs from "./TaskGitRefs";
import s from "./TaskDetailModal.module.css";

interface TaskDetailViewProps {
    task: any;
    availableSprints: any[];
    customFields: any[];
    customValues: Record<string, unknown>;
    currentUser: { id?: number; role?: string } | null | undefined;
    onStatusChange: (task: any, option: any) => void;
    /** Discussion and history, rendered under the content in the main column. */
    activity?: React.ReactNode;
}

/**
 * The read-only task view.
 *
 * Content first: the title, status and description own the main column, and
 * the properties sit in a quieter column beside them on wide screens. On a
 * narrow screen the same blocks stack in reading order — title, status,
 * description, properties — instead of stretching a two-column grid until it
 * collapses.
 */
export default function TaskDetailView({
    task,
    availableSprints,
    customFields,
    customValues,
    currentUser,
    onStatusChange,
    activity,
}: TaskDetailViewProps) {
    const labels: any[] = task.labels ?? [];

    return (
        <div className={s["detail-layout"]}>
            <div className={s["detail-main"]}>
                <header className={s["detail-hero"]}>
                    <div className={s["detail-hero-meta"]}>
                        {task.issue_key ? (
                            <span
                                className={s["backlog-ticket-id"]}
                                title={task.project?.name || "Project issue key"}
                                style={{
                                    background: task.project?.color
                                        ? `${task.project.color}22`
                                        : undefined,
                                    color: task.project?.color || undefined,
                                    fontWeight: 700,
                                }}
                            >
                                {task.issue_key}
                            </span>
                        ) : (
                            <span className={s["backlog-ticket-id"]}>#{task.id}</span>
                        )}
                        <WorkItemTypeBadge value={task.work_item_type_id} />
                        <StoryPointBadge value={task.story_points} />
                        <BlockerBadge task={task} />
                    </div>

                    <h2 className={s["detail-title"]}>{task.title}</h2>

                    {labels.length > 0 && (
                        <div className={s["detail-labels"]}>
                            {labels.map((l: any) => (
                                <span
                                    key={l.id}
                                    className={s["label-pill"]}
                                    style={{ "--label-color": l.color } as React.CSSProperties}
                                >
                                    {l.name}
                                </span>
                            ))}
                        </div>
                    )}

                    <TaskStatusControl
                        task={task}
                        currentUser={currentUser}
                        onChange={onStatusChange}
                    />

                    {task.is_blocked && (
                        <div className={s["detail-blocker-banner"]}>
                            <span
                                className={s["detail-blocker-readonly"]}
                                title={task.blocked_reason || "Blocked"}
                            >
                                <GlyphBan size="1em" style={{ verticalAlign: "middle" }} />{" "}
                                Blocked
                                {task.blocked_reason ? `: ${task.blocked_reason}` : ""}
                            </span>
                        </div>
                    )}
                </header>

                {task.description && (
                    <HighlightedHtml
                        html={task.description}
                        className={s["detail-description"]}
                    />
                )}

                {customFields.length > 0 && Object.keys(customValues).length > 0 && (
                    <CustomFieldsSummary values={customValues} />
                )}

                {Array.isArray(task.acceptance_criteria) &&
                    task.acceptance_criteria.length > 0 && (
                        <div className={s["detail-readonly-section"]}>
                            <div className={s["detail-readonly-title"]}>
                                Acceptance Criteria{" "}
                                <span className={s["detail-readonly-progress"]}>
                                    (
                                    {
                                        task.acceptance_criteria.filter((c: any) => c.done)
                                            .length
                                    }
                                    /{task.acceptance_criteria.length})
                                </span>
                            </div>
                            <ul className={s["detail-readonly-list"]}>
                                {task.acceptance_criteria.map((c: any, i: number) => (
                                    <li key={c.id || i} className={c.done ? s["ac-done"] : ""}>
                                        <span className={s["ac-check"]}>
                                            {c.done ? (
                                                <InlineCheckSquare
                                                    size="1em"
                                                    style={{ verticalAlign: "middle" }}
                                                />
                                            ) : (
                                                <InlineSquare
                                                    size="1em"
                                                    style={{ verticalAlign: "middle" }}
                                                />
                                            )}
                                        </span>{" "}
                                        {c.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                <TaskTimePanel task={task} />

                <TaskGitRefs taskId={task.id} />
            </div>

            <aside className={s["detail-properties"]} aria-label="Task properties">
                <h3 className={s["detail-properties-title"]}>Properties</h3>
                <TaskMetaGrid task={task} availableSprints={availableSprints} />
            </aside>

            {/* A sibling of the two columns, not a child of the main one: on a
                narrow screen the properties must come before the discussion,
                and only a grid child can be reordered past the aside. */}
            {activity && <div className={s["detail-activity"]}>{activity}</div>}
        </div>
    );
}
