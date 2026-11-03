import React from "react";
import { ArrowDownCircle, ClipboardList } from "../../constants/icons";
import SprintProgressCard from "./SprintProgressCard";
import SprintImportPanel from "./SprintImportPanel";
import KanbanBoard from "./KanbanBoard";
import SprintCancelledSection from "./SprintCancelledSection";
import SprintPlan from "./SprintPlan";
import AsyncSection from "../../components/common/AsyncSection";
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
    columns: any[];
    drag: any;
    sprintMode: boolean;
    onOpenDetail: (task: any) => void;
    onOpenComments: (id: number | string) => void;
    /** Creates a ticket in the running sprint, in the column's state. */
    onAddTask?: (column: any) => void;
    boardDrag: any;
    boardAnnouncement: string;
    attribution: Record<string, { name: string }>;
    plan: boolean;
    sprintPlan: any;
    epics: any[];
    selectedEpicId: number | string | null;
    onSelectEpic: (id: number | string | null) => void;
    teamMode?: "sprints" | "continuous";
    /** Reload the sprint's tasks after a failed load. */
    onRetry: () => void;
    /** The board's team scope, for the cancelled list. */
    scopeParams?: Record<string, unknown>;
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
    columns,
    drag,
    sprintMode,
    onOpenDetail,
    onOpenComments,
    onAddTask,
    boardDrag,
    boardAnnouncement,
    attribution,
    plan,
    sprintPlan,
    epics,
    selectedEpicId,
    onSelectEpic,
    teamMode = "sprints",
    onRetry,
    scopeParams,
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

            {plan ? (
                <SprintPlan
                    backlogTasks={backlog.backlogTasks}
                    backlogLoading={backlog.backlogLoading}
                    backlogError={backlog.backlogError}
                    onRetryBacklog={backlog.fetchBacklog}
                    sprintLoading={loading}
                    sprintError={error}
                    onRetrySprint={onRetry}
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
                <AsyncSection
                    label="sprint board"
                    loading={loading}
                    error={error}
                    hasData={tasks.length > 0}
                    onRetry={onRetry}
                >
                    <KanbanBoard
                        tasks={tasks}
                        columns={columns}
                        drag={drag}
                        sprintMode={sprintMode}
                        onOpenDetail={onOpenDetail}
                        onOpenComments={onOpenComments}
                        onAddTask={onAddTask}
                        boardDrag={boardDrag}
                        announcement={boardAnnouncement}
                        attribution={attribution}
                    />
                </AsyncSection>
            )}
            {!plan && (
                <SprintCancelledSection sprintId={selectedSprintId} scopeParams={scopeParams} onOpenDetail={onOpenDetail} />
            )}

            {tasks.length === 0 && !loading && !error && (
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
