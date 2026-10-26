import { Plus as ActivityPlus, ArrowLeftRight as ActivitySwap, Edit as ActivityEdit, Calendar as ActivityCalendar, MessageSquare as ActivityMessage, Trash2 as ActivityDelete, type IconComponent, X, Package, CalendarDays, Save, Pencil, MessageSquare, Clock, Trash2, Folder } from "../../constants/icons";
import React, { useState, useEffect } from "react";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import CommentSection from "../../components/profile/CommentSection";
import SprintSelector from "../../components/common/SprintSelector";
import LabelSelector from "./LabelSelector";
import { PRIORITIES } from "./constants";
import { currentStatusOption, statusOptions } from "./taskStatus";
import { formatDueDate, isDueOverdue, getAvatarUrl } from "./utils";
import { useTaskCtx } from "./TaskContext";
import {
    StoryPointPicker,
    WorkItemTypePicker,
} from "../../components/agile/AgilePickers";
import AcceptanceCriteria from "../../components/agile/AcceptanceCriteria";
import {
    BlockerControl,
    DependenciesPanel,
    ParentChildPanel,
} from "../../components/agile/AgileWorkflowPanels";
import { CustomFieldsEditor } from "../../components/customFields/CustomFieldRenderer";
import { useAgileConfig } from "../../AgileConfigContext";
import { useCustomFields } from "../../CustomFieldsContext";
import { getTaskDetail, getTaskCustomFieldValues } from "../../api/tasks";
import TaskDetailSheet from "./TaskDetailSheet";
import TaskHistoryList from "./TaskHistoryList";
import TaskDetailView from "./TaskDetailView";
import s from "./TaskDetailModal.module.css";

interface TaskDetailModalProps {
    detailTask: any;
    detailComments: any[];
    detailLoading: boolean;
    detailEditing: boolean;
    detailTab: string;
    setDetailTab: (tab: string) => void;
    detailHistory: any[];
    onClose: () => void;
    onStartEdit: () => void;
    onSaveEdit: (data: any) => void;
    onCancelEdit: () => void;
    onDelete: (task: any) => void;
    onAddComment: (...args: any[]) => void;
    onEditComment: (...args: any[]) => void;
    onDeleteComment: (...args: any[]) => void;
    onSchedule: (
        id: number | string,
        title: string,
        onClose: () => void,
        dueDate: string,
    ) => void;
    onUnschedule: (
        id: number | string,
        title: string,
        onClose: () => void,
    ) => void;
    onStatusChange: (task: any, col: any) => void;
    showConfirm?: (...args: any[]) => void;
    closeConfirm?: (...args: any[]) => void;
    fetchTasks?: () => void;
    fetchBacklog?: () => void;
    setError?: (msg: string) => void;
}

export default function TaskDetailModal({
    detailTask,
    detailComments,
    detailLoading,
    detailEditing,
    detailTab,
    setDetailTab,
    detailHistory,
    // Callbacks
    onClose,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onDelete,
    onAddComment,
    onEditComment,
    onDeleteComment,
    onSchedule,
    onUnschedule,
    onStatusChange,
    showConfirm,
    closeConfirm,
    fetchTasks,
    fetchBacklog,
    setError,
}: TaskDetailModalProps) {
    const {
        assignableUsers,
        orgLabels,
        availableSprints,
        availableProjects,
        currentUser,
        activeTab,
    } = useTaskCtx() as any;
    const { typeById, workflowStates } = useAgileConfig() as any;
    const { fields: customFields } = useCustomFields() as unknown as {
        fields: any[];
    };
    // Pull the task's custom-field values once when the modal opens so the
    // read-only summary in view mode has data to render.
    const [customValues, setCustomValues] = useState<Record<string, unknown>>(
        {},
    );
    useEffect(() => {
        if (!detailTask?.id || customFields.length === 0) {
            setCustomValues({});
            return;
        }
        let cancelled = false;
        getTaskCustomFieldValues(detailTask.id)
            .then((r) => {
                if (!cancelled) setCustomValues((r.data as any)?.values || {});
            })
            .catch(() => {
                if (!cancelled) setCustomValues({});
            });
        return () => {
            cancelled = true;
        };
    }, [detailTask?.id, customFields.length]);
    // Used to swap the dependencies panel for the Epic↔children panel and vice-versa.
    const isEpic = !!(
        detailTask?.work_item_type_id &&
        typeById[detailTask.work_item_type_id]?.is_epic
    );

    // Helper used by the Parent/Child links — replaces the modal contents with
    // the linked ticket so users can navigate parent ↔ child without losing
    // context. Falls back to a query-string nav if the parent didn't supply
    // an opener via the `detail` prop.
    const swapToTask = (id: number | string) => {
        getTaskDetail(id as any)
            .then((res) => {
                if ((window as any).__openTaskDetail)
                    (window as any).__openTaskDetail(res.data);
                else window.location.href = `/tasks?task=${id}`;
            })
            .catch(() => {
                window.location.href = `/tasks?task=${id}`;
            });
    };

    // Edit state lives here — co-located with the form that uses it.
    const [editTitle, setEditTitle] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [editPriority, setEditPriority] = useState("medium");
    const [editAssignedTo, setEditAssignedTo] = useState("");
    const [editDueDate, setEditDueDate] = useState("");
    const [editPlannedDate, setEditPlannedDate] = useState("");
    const [editSprintId, setEditSprintId] = useState<number | string>("");
    const [editLabels, setEditLabels] = useState<Array<number | string>>([]);
    const [editLabelDropdownOpen, setEditLabelDropdownOpen] = useState(false);
    const [editStoryPoints, setEditStoryPoints] = useState<any>(null);
    const [editWorkItemType, setEditWorkItemType] = useState<any>("");
    const [editProjectId, setEditProjectId] = useState<string | number>("");

    // Initialise edit fields from detailTask whenever edit mode is entered.
    useEffect(() => {
        if (detailEditing && detailTask) {
            setEditTitle(detailTask.title);
            setEditDesc(detailTask.description || "");
            setEditPriority(detailTask.priority || "medium");
            setEditAssignedTo(String(detailTask.assigned_to || ""));
            setEditDueDate(detailTask.due_date || "");
            setEditPlannedDate(detailTask.planned_date || "");
            setEditSprintId(detailTask.sprint_id || "");
            setEditLabels(detailTask.labels?.map((l: any) => l.id) || []);
            setEditLabelDropdownOpen(false);
            setEditStoryPoints(detailTask.story_points ?? null);
            setEditWorkItemType(detailTask.work_item_type_id || "");
            setEditProjectId(detailTask.project_id || "");
        }
    }, [detailEditing]);

    const handleSaveEdit = () => {
        onSaveEdit({
            title: editTitle,
            description: editDesc,
            priority: editPriority,
            assignedTo: editAssignedTo,
            dueDate: editDueDate,
            plannedDate: editPlannedDate,
            sprintId: editSprintId,
            labels: editLabels,
            storyPoints: editStoryPoints,
            workItemType: editWorkItemType,
            projectId: editProjectId,
        });
    };

    const toggleLabel = (id: number | string) => {
        setEditLabels((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    };
    if (!detailTask) return null;

    const pri =
        PRIORITIES.find((pr) => pr.value === detailTask.priority) || PRIORITIES[1];
    const statusOpts = statusOptions(workflowStates);
    const colInfo = currentStatusOption(detailTask, workflowStates, statusOpts) || statusOpts[0];
    const dueFmt = formatDueDate(detailTask.due_date);
    const overdue =
        isDueOverdue(detailTask.due_date) && !detailTask.completed_at;
    // `planned_date` is the scheduling field; `date` is the legacy column the
    // server still mirrors it into until the contract migration lands.
    const plannedDate = detailTask.planned_date || null;
    // A task is "backlog" only if it has neither a scheduled date nor a sprint
    // assignment. Sprint tickets without a daily-planner date are NOT backlog.
    const isBacklogItem = !detailTask.sprint_id;

    return (
        <TaskDetailSheet
            open
            title={detailTask.title}
            onClose={onClose}
            badges={
                <>
                    {/* The key is the one identifier that must survive scrolling:
                        it is how people refer to the ticket in chat and commits. */}
                    <span
                        className={s["backlog-ticket-id"]}
                        title={detailTask.project?.name || "Project issue key"}
                        style={{
                            background: detailTask.project?.color
                                ? `${detailTask.project.color}22`
                                : undefined,
                            color: detailTask.project?.color || undefined,
                            fontWeight: 700,
                        }}
                    >
                        {detailTask.issue_key || `#${detailTask.id}`}
                    </span>
                    <span
                        className={s["task-priority-badge"]}
                        style={
                            {
                                "--badge-bg": pri.color + "20",
                                "--badge-color": pri.ink,
                            } as React.CSSProperties
                        }
                    >
                        {pri.icon} {pri.label}
                    </span>
                    <span
                        className={s["backlog-status-badge"]}
                        style={
                            {
                                "--badge-bg": colInfo.color + "20",
                                "--badge-color": colInfo.ink,
                            } as React.CSSProperties
                        }
                    >
                        {colInfo.icon ? `${colInfo.icon} ` : ""}{colInfo.label}
                    </span>
                    {isBacklogItem && (
                        <span className={s["backlog-badge"]}>
                            <Package
                                size={12}
                                style={{ marginRight: 3, verticalAlign: "middle" }}
                            />
                            Backlog
                        </span>
                    )}
                </>
            }
            actions={
                <>
                    {!detailEditing && (
                        <>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={onStartEdit}
                            >
                                <Pencil
                                    size={13}
                                    style={{ marginRight: 4, verticalAlign: "middle" }}
                                />
                                Edit
                            </button>
                            {currentUser?.id === detailTask?.user_id && (
                                <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => onDelete(detailTask)}
                                    title="Cancelling keeps the ticket and its history; it leaves the open work."
                                >
                                    <Trash2 size={13} style={{ marginRight: 4, verticalAlign: "middle" }} />
                                    Cancel ticket
                                </button>
                            )}
                        </>
                    )}
                    {detailEditing && (
                        <>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleSaveEdit}
                            >
                                <Save
                                    size={13}
                                    style={{ marginRight: 4, verticalAlign: "middle" }}
                                />
                                Save Changes
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={onCancelEdit}
                            >
                                Cancel Edit
                            </button>
                        </>
                    )}
                </>
            }
        >
            <div className={s["detail-modal-body"]}>
                    {detailEditing ? (
                        /* ─── EDIT MODE ─── */
                        <div className={s["detail-edit-section"]}>
                            <div className="form-group">
                                <label>Title</label>
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    className={s["task-edit-input"]}
                                    autoFocus
                                />
                            </div>
                            <div className={`form-group ${s["quill-wrapper"]}`}>
                                <label>Description</label>
                                <ReactQuill
                                    theme="snow"
                                    value={editDesc}
                                    onChange={setEditDesc}
                                    placeholder="Description"
                                />
                            </div>
                            <div className={s["form-extras"]}>
                                <div className={s["form-extra-group"]}>
                                    <label>Priority</label>
                                    <select
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                    >
                                        {PRIORITIES.map((p) => (
                                            <option key={p.value} value={p.value}>
                                                {p.icon} {p.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className={s["form-extra-group"]}>
                                    <label>Assign to</label>
                                    <select
                                        value={editAssignedTo}
                                        onChange={(e) => setEditAssignedTo(e.target.value)}
                                    >
                                        <option value="">Unassigned</option>
                                        {assignableUsers.map((u: any) => (
                                            <option key={u.id} value={u.id}>
                                                {u.full_name || u.username}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className={s["form-extra-group"]}>
                                    <label htmlFor="task-planned-date">
                                        Planned date
                                    </label>
                                    <input
                                        id="task-planned-date"
                                        type="date"
                                        value={editPlannedDate}
                                        onChange={(e) => setEditPlannedDate(e.target.value)}
                                        aria-describedby="task-planned-date-hint"
                                    />
                                    <small
                                        id="task-planned-date-hint"
                                        className={s["form-extra-hint"]}
                                    >
                                        When this is scheduled to be worked on. Does not
                                        remove it from the backlog.
                                    </small>
                                </div>
                                <div className={s["form-extra-group"]}>
                                    <label htmlFor="task-due-date">Due date</label>
                                    <input
                                        id="task-due-date"
                                        type="date"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        aria-describedby="task-due-date-hint"
                                    />
                                    <small
                                        id="task-due-date-hint"
                                        className={s["form-extra-hint"]}
                                    >
                                        The deadline. Drives overdue warnings and due-date
                                        reminders.
                                    </small>
                                </div>
                                <SprintSelector
                                    sprints={availableSprints}
                                    selected={editSprintId as any}
                                    onChange={(id: any) => {
                                        setEditSprintId(id as any);
                                        if (!id) {
                                            setEditDueDate("");
                                        } else {
                                            const sp = availableSprints.find(
                                                (sp: any) => sp.id === id,
                                            );
                                            if (sp) setEditDueDate(sp.end_date);
                                        }
                                    }}
                                />
                                <LabelSelector
                                    labels={orgLabels}
                                    selected={editLabels}
                                    onToggle={toggleLabel}
                                    open={editLabelDropdownOpen}
                                    setOpen={setEditLabelDropdownOpen}
                                />
                                <div className={s["form-extra-group"]}>
                                    <label>Type</label>
                                    <WorkItemTypePicker
                                        value={editWorkItemType}
                                        onChange={setEditWorkItemType}
                                    />
                                </div>
                                {availableProjects && availableProjects.length > 0 && (
                                    <div className={s["form-extra-group"]}>
                                        <label>
                                            <Folder
                                                size={13}
                                                style={{ marginRight: 4, verticalAlign: "middle" }}
                                            />
                                            Project
                                        </label>
                                        {detailTask.project_id ? (
                                            /* Project assignment is one-way — once a task has a
                         project (and therefore an immutable issue key like
                         WEB-123), we render a read-only chip. Letting users
                         re-key it would orphan every branch/commit/link that
                         already mentions the old key. */
                                            <div
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                    padding: "6px 10px",
                                                    borderRadius: 6,
                                                    background: detailTask.project?.color
                                                        ? `${detailTask.project.color}22`
                                                        : "rgba(255,255,255,0.06)",
                                                    color: detailTask.project?.color || "inherit",
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    fontFamily: "monospace",
                                                }}
                                                title="Project assignment is permanent (it would invalidate the issue key)"
                                            >
                                                <Folder size={12} />
                                                {detailTask.issue_key ||
                                                    detailTask.project?.key ||
                                                    "—"}
                                            </div>
                                        ) : (
                                            <select
                                                value={editProjectId || ""}
                                                onChange={(e) => setEditProjectId(e.target.value)}
                                                title="Assign to a project to get a stable issue key (e.g. WEB-123). This cannot be changed once set."
                                            >
                                                <option value="">— No project —</option>
                                                {availableProjects.map((p: any) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.key} · {p.name}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    marginTop: 8,
                                }}
                            >
                                <StoryPointPicker
                                    value={editStoryPoints}
                                    onChange={setEditStoryPoints}
                                />
                            </div>
                            <div className={s["detail-edit-buttons"]}>
                                {isBacklogItem || activeTab === "backlog" ? (
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() =>
                                            onSchedule(
                                                detailTask.id,
                                                detailTask.title,
                                                onClose,
                                                editDueDate,
                                            )
                                        }
                                    >
                                        <CalendarDays
                                            size={13}
                                            style={{ marginRight: 4, verticalAlign: "middle" }}
                                        />
                                        Schedule to Day
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() =>
                                            onUnschedule(detailTask.id, detailTask.title, onClose)
                                        }
                                    >
                                        <Package
                                            size={13}
                                            style={{ marginRight: 4, verticalAlign: "middle" }}
                                        />
                                        Move to Backlog
                                    </button>
                                )}
                            </div>

                            {/* Pass 2 editors — only available while editing the ticket so
                  the read-only view stays clean and changes are clustered with
                  other edits. Clicking Save Changes closes edit mode (parent
                  refresh re-fetches detail), so any saves done here also persist. */}
                            <BlockerControl
                                task={detailTask}
                                onChanged={() => fetchTasks && fetchTasks()}
                            />
                            <AcceptanceCriteria taskId={detailTask.id} />
                            {/* Epics show their child tickets; everything else shows its
                  parent + dependencies. The panel decides what to render
                  based on the work item type's is_epic flag. */}
                            <ParentChildPanel
                                task={detailTask}
                                onOpenTask={swapToTask}
                                onChanged={() => fetchTasks && fetchTasks()}
                            />
                            {!isEpic && <DependenciesPanel task={detailTask} />}
                            <CustomFieldsEditor
                                taskId={detailTask.id}
                                workItemTypeId={detailTask.work_item_type_id}
                                onSaved={(v: any) => setCustomValues(v)}
                            />
                        </div>
                    ) : (
                        /* ─── VIEW MODE ─── */
                        <TaskDetailView
                            task={detailTask}
                            availableSprints={availableSprints}
                            customFields={customFields}
                            customValues={customValues}
                            currentUser={currentUser}
                            onStatusChange={onStatusChange}
                            activity={
                                <div className={s["detail-comments"]}>
                                    <div className={s["detail-tab-switcher"]}>
                                        <button
                                            className={`${s["detail-tab-btn"]} ${detailTab === "comments" ? s.active : ""}`}
                                            onClick={() => setDetailTab("comments")}
                                        >
                                            <MessageSquare
                                                size={13}
                                                style={{ marginRight: 4, verticalAlign: "middle" }}
                                            />
                                            Comments{" "}
                                            <span className={s["detail-tab-count"]}>
                                                {detailComments.length}
                                            </span>
                                        </button>
                                        <button
                                            className={`${s["detail-tab-btn"]} ${detailTab === "history" ? s.active : ""}`}
                                            onClick={() => setDetailTab("history")}
                                        >
                                            <Clock
                                                size={13}
                                                style={{ marginRight: 4, verticalAlign: "middle" }}
                                            />
                                            History{" "}
                                            <span className={s["detail-tab-count"]}>
                                                {detailHistory.length}
                                            </span>
                                        </button>
                                    </div>

                                    {detailTab === "comments" && (
                                        <CommentSection
                                            comments={detailComments}
                                            loading={detailLoading}
                                            currentUserId={currentUser?.id}
                                            users={assignableUsers}
                                            onAdd={onAddComment}
                                            onEdit={onEditComment}
                                            onDelete={onDeleteComment}
                                        />
                                    )}

                                    {detailTab === "history" && (
                                        <TaskHistoryList history={detailHistory as any} />
                                    )}
                                </div>
                            }
                        />
                    )}
            </div>
        </TaskDetailSheet>
    );
}
