import React from "react";
import { ArrowDownCircle, ClipboardList } from "../../constants/icons";
import SprintProgressCard from "./SprintProgressCard";
import SprintImportPanel from "./SprintImportPanel";
import KanbanBoard from "./KanbanBoard";
import SprintPlan from "./SprintPlan";
import s from "../Tasks.module.css";

interface SprintTabProps {
    stats: any;
    sprintStats: any;
    features: any;
    unitLabel: string;
    availableSprints: any[];
    selectedSprintId: any;
    currentUser: any;
    getColTasks: (colId: string) => any[];
    onSprintChanged: () => void;
    carriedCount: number;
    error: string;
    sprintImportOpen: boolean;
    backlog: any;
    assignableUsers: any[];
    onCloseImport: () => void;
    loading: boolean;
    tasks: any[];
    drag: any;
    sprintMode: boolean;
    onOpenDetail: (task: any) => void;
    onOpenComments: (id: number | string) => void;
    boardDrag: any;
    boardAnnouncement: string;
    plan: boolean;
    sprintPlan: any;
    epics: any[];
    selectedEpicId: number | string | null;
    onSelectEpic: (id: number | string | null) => void;
    teamMode?: "sprints" | "continuous";
}

/**
 * The Sprint tab: header, import panel, then either the Plan split view or the
 * Board. Extracted from the Tasks page to keep that page within the file-size
 * ratchet.
 */
export default function SprintTab({
    stats,
    sprintStats,
    features,
    unitLabel,
    availableSprints,
    selectedSprintId,
    currentUser,
    getColTasks,
    onSprintChanged,
    carriedCount,
    error,
    sprintImportOpen,
    backlog,
    assignableUsers,
    onCloseImport,
    loading,
    tasks,
    drag,
    sprintMode,
    onOpenDetail,
    onOpenComments,
    boardDrag,
    boardAnnouncement,
    plan,
    sprintPlan,
    epics,
    selectedEpicId,
    onSelectEpic,
    teamMode = "sprints",
}: SprintTabProps) {
    return (
        <>
            {teamMode === "continuous" && (
                <div className={s["carry-banner"]} role="status">
                    Continuous mode: this sprint rolls forward automatically. The backlog still
                    means work that is not in a sprint.
                </div>
            )}
            <SprintProgressCard
                stats={stats}
                sprintStats={sprintStats}
                features={features}
                unitLabel={unitLabel}
                availableSprints={availableSprints}
                selectedSprintId={selectedSprintId}
                currentUser={currentUser}
                getColTasks={getColTasks}
                onSprintChanged={onSprintChanged}
            />

            {carriedCount > 0 && (
                <div className={s["carry-banner"]}>
                    <ArrowDownCircle size={14} style={{ marginRight: 5, verticalAlign: "middle" }} />
                    {carriedCount} incomplete item{carriedCount > 1 ? "s" : ""} from yesterday
                    carried forward automatically.
                </div>
            )}
            {error && <div className="error-msg error-msg-mb">{error}</div>}

            {sprintImportOpen && (
                <SprintImportPanel
                    backlogTasks={backlog.backlogTasks}
                    backlogLoading={backlog.backlogLoading}
                    selectedSprintId={selectedSprintId}
                    availableSprints={availableSprints}
                    assignableUsers={assignableUsers}
                    importConfigTask={backlog.importConfigTask}
                    importAssignedTo={backlog.importAssignedTo}
                    importDueDate={backlog.importDueDate}
                    onSetImportConfigTask={backlog.setImportConfigTask}
                    onSetImportAssignedTo={backlog.setImportAssignedTo}
                    onSetImportDueDate={backlog.setImportDueDate}
                    onImportToSprint={backlog.handleImportToSprint}
                    onClose={onCloseImport}
                />
            )}

            {loading ? (
                <div className="loading-spinner">
                    <div className="spinner" />
                </div>
            ) : plan ? (
                <SprintPlan
                    backlogTasks={backlog.backlogTasks}
                    sprintTasks={tasks}
                    sprint={availableSprints.find((sp: any) => sp.id === selectedSprintId)}
                    velocity={sprintPlan.velocity}
                    burndown={sprintPlan.burndown}
                    unitLabel={unitLabel}
                    onMoveToSprint={sprintPlan.moveToSprint}
                    onMoveToBacklog={sprintPlan.moveToBacklog}
                    onSaveGoal={sprintPlan.saveGoal}
                    onOpenDetail={onOpenDetail}
                    epics={epics}
                    selectedEpicId={selectedEpicId}
                    onSelectEpic={onSelectEpic}
                    scope={sprintPlan.scope}
                />
            ) : (
                <KanbanBoard
                    tasks={tasks}
                    dragOverCol={drag.dragOverCol}
                    sprintMode={sprintMode}
                    onDragOver={drag.onDragOver}
                    onDragLeave={drag.onDragLeave}
                    onDrop={drag.onDrop}
                    onDragStart={drag.onDragStart}
                    onDragEnd={drag.onDragEnd}
                    onOpenDetail={onOpenDetail}
                    onOpenComments={onOpenComments}
                    boardDrag={boardDrag}
                    wipWarning={boardDrag.wipWarning}
                    announcement={boardAnnouncement}
                    attribution={backlog.attribution}
                />
            )}

            {tasks.length === 0 && !loading && (
                <div className={s["tasks-empty"]}>
                    <div className={s["tasks-empty-icon"]}>
                        <ClipboardList size={36} strokeWidth={1.5} />
                    </div>
                    <p>No items in this sprint</p>
                    <span>Assign tickets from the Backlog to this sprint.</span>
                </div>
            )}
        </>
    );
}
