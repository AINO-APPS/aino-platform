import { BarChart3 as StatsIcon, AlertTriangle as GlyphAlertTriangle, Ban as GlyphBan, ArrowDownCircle, ClipboardList } from "../constants/icons";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { getTasks, updateTaskStatus, deleteTask, carryForwardTasks, getAssignableUsers, getTaskLabels, addTaskComment, updateTaskComment, getTaskDetail, getAvailableSprints, getSprintStats, getProjects } from "../api/tasks";
import { getLocalToday } from "../api/client";
import { getTeamSprintConfig } from "../api/organization";
import { useAgileConfig } from "../AgileConfigContext";
import { useFeatures } from "../FeaturesContext";
import { SprintLifecycleControls } from "../components/agile/AgileWorkflowPanels";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { useAuth } from "../AuthContext";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import "highlight.js/styles/github-dark.css";

import { COLUMNS } from "./tasks/constants";
import KanbanBoard from "./tasks/KanbanBoard";
import SprintImportPanel from "./tasks/SprintImportPanel";
import BacklogTab from "./tasks/BacklogTab";
import TasksHeader from "./tasks/TasksHeader";
import TaskDetailModal from "./tasks/TaskDetailModal";
import InlineCommentPanel from "./tasks/InlineCommentPanel";
import ServiceDeskTab from "./tasks/ServiceDeskTab";
import ScheduledTab from "./tasks/ScheduledTab";
import SprintProgressCard from "./tasks/SprintProgressCard";
import BulkActionBar from "./tasks/BulkActionBar";
import BacklogBulkBar from "./tasks/BacklogBulkBar";
import { useToast } from "../components/common/Toast";
import { TaskProvider } from "./tasks/TaskContext";

import { useConfirmDialog } from "./tasks/hooks/useConfirmDialog";
import { useFilters } from "./tasks/hooks/useFilters";
import { useGlobalSearch } from "./tasks/hooks/useGlobalSearch";
import { useComments } from "./tasks/hooks/useComments";
import { useBacklog } from "./tasks/hooks/useBacklog";
import { useTaskDetail } from "./tasks/hooks/useTaskDetail";
import { useDragDrop } from "./tasks/hooks/useDragDrop";
import { useTasksRoute, tasksViewPath } from "./tasks/hooks/useTasksRoute";
import { useTasksRouteSync, useTaskDeepLink } from "./tasks/hooks/useTasksRouteSync";
import { useUndoToast } from "./tasks/hooks/useUndoToast";

import s from "./Tasks.module.css";

const EMPTY: any[] = [];

export default function Tasks() {
  const { user: currentUser } = useAuth() as any;
  const { hasFeature } = useFeatures();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    total: 0,
    done: 0,
    inProgress: 0,
    percent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => getLocalToday());
  const [error, setError] = useAutoDismiss("") as [string, (v: string) => void];
  const [taskToDelete, setTaskToDelete] = useState<any>(null);
  const [carriedCount, setCarriedCount] = useState(0);
  const [activeTab, setActiveTab] = useState("backlog");
  const [selectedSprintId, setSelectedSprintId] = useState<any>(null);
  // Tabs are real routes: the URL is the source of truth for the view.
  const tasksRoute = useTasksRoute();
  const [sprintImportOpen, setSprintImportOpen] = useState(false);
  const [scheduledFocus, setScheduledFocus] = useState<string | null>(null);
  const toast = useToast() as any;
  const { data: assignableUsers = EMPTY } = useQuery({
    queryKey: ["tasks", "assignableUsers"],
    queryFn: async () => (await getAssignableUsers()).data as any[],
  });
  const { data: orgLabels = EMPTY } = useQuery({
    queryKey: ["tasks", "labels"],
    queryFn: async () => (await getTaskLabels()).data as any[],
  });
  // Stage 3: project list powers the "Project" picker in backlog create and
  // task edit. Active projects only — archived ones can't accept new tickets.
  const { data: availableProjects = EMPTY } = useQuery({
    queryKey: ["tasks", "projects"],
    queryFn: async () => {
      const r = await getProjects(false);
      return Array.isArray(r.data) ? (r.data as any[]) : [];
    },
  });
  // Always ask the backend — it knows about platform_admin / super_admin /
  // hr_admin who can see every team's sprints, and will correctly return []
  // for users with no team. Don't gate on currentUser.team_id: the cached
  // profile may be stale (especially in the desktop app where the renderer
  // doesn't auto-reload after a team is assigned).
  const { data: availableSprints = EMPTY } = useQuery({
    queryKey: ["tasks", "availableSprints"],
    // "Agile & Sprints" gate: skip the (server-403-gated) sprint lookup
    // entirely when the tenant's plan/feature-override disables agile.
    enabled: hasFeature("agile"),
    queryFn: async () => {
      try {
        return (await getAvailableSprints()).data as any[];
      } catch (err: any) {
        // Mid-session feature toggle → treat the feature-gate 403 as "no
        // sprints" instead of a retryable error.
        if (err?.response?.status === 403) return [] as any[];
        throw err;
      }
    },
  });

  // If agile gets disabled while the user is on the Sprint tab (feature
  // override flipped from the platform console), bounce back to Backlog.
  useEffect(() => {
    if (!hasFeature("agile") && activeTab === "sprint") {
      setActiveTab("backlog");
    }
  }, [hasFeature, activeTab]);
  const [sprintStats, setSprintStats] = useState<any>(null);
  const { unitLabel, features } = useAgileConfig() as any;
  const autoCarriedRef = useRef<string | null>(null); // stores the last date carry-forward ran

  const { confirmDialog, showConfirm, closeConfirm } =
    useConfirmDialog() as any;
  const filters = useFilters({ activeTab }) as any;
  const globalSearch = useGlobalSearch() as any;

  // Tab changes are navigations, so every view has a revisitable URL.
  const changeTab = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      tasksRoute.goToView(tab as any, tab === "sprint" ? selectedSprintId : null);
    },
    [tasksRoute, selectedSprintId],
  );

  const fetchTasks = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const params: any = { ...filters.plannerFilters };
        if (activeTab === "sprint" && selectedSprintId) {
          params.sprint_id = selectedSprintId;
          const res = await getTasks(undefined as any, params, signal as any);
          setTasks((res.data as any).tasks);
          setStats((res.data as any).stats);
        } else {
          setTasks([]);
          setStats({ total: 0, done: 0, inProgress: 0, percent: 0 });
        }
        setError("");
      } catch {
        setError("Failed to load tasks");
      } finally {
        setLoading(false);
      }
    },
    [date, activeTab, selectedSprintId, filters.plannerFilters],
  );

  const backlog = useBacklog({
    activeTab,
    backlogOpen: false,
    date,
    backlogFilters: filters.backlogFilters,
    selectedSprintId,
    showConfirm,
    closeConfirm,
    fetchTasks,
    setError,
    onScheduled: (_id: any, day: string) => toast.success(<span>Scheduled for {day} <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => { setScheduledFocus(day); setActiveTab("scheduled"); }}>View</button></span>, 6000),
  }) as any;
  const detail = useTaskDetail({
    activeTab,
    backlogOpen: false,
    showConfirm,
    closeConfirm,
    setTasks,
    setBacklogTasks: backlog.setBacklogTasks,
    fetchTasks,
    fetchBacklog: backlog.fetchBacklog,
    setError,
  } as any) as any;

  // Undo affordance: every destructive or moving action offers its inverse for
  // ten seconds, reachable and operable by keyboard.
  const offerUndo = useUndoToast(toast, () => backlog.undo.undo());
  const comments = useComments({
    showConfirm,
    closeConfirm,
    setTasks,
    setError,
  }) as any;
  const drag = useDragDrop({
    tasks,
    setTasks,
    showConfirm,
    closeConfirm,
    setError,
  }) as any;

  // Keep a valid sprint selected once the sprint list resolves: preserve the
  // current pick if it still exists, otherwise default to the active sprint
  // (or the first one).
  useEffect(() => {
    if (!availableSprints.length) return;
    setSelectedSprintId((prev: any) =>
      prev && availableSprints.some((sp) => sp.id === prev)
        ? prev
        : (availableSprints.find((sp) => sp.status === "active")?.id ??
          availableSprints[0].id),
    );
  }, [availableSprints]);

  // The URL is the source of truth for the view. Legacy `?tab=` links are
  // redirected to their route so old bookmarks keep working.
  useTasksRouteSync({
    route: tasksRoute.route,
    searchParams,
    navigate,
    setActiveTab,
    setSelectedSprintId,
  });

  // Deep links to a specific task open its detail on arrival.
  useTaskDeepLink(searchParams, detail.openTaskDetail);

  // Expose the detail-opener globally so deep-linked components (e.g. Epic
  // child-ticket links inside the task detail modal) can swap the modal
  // contents without unmounting / re-routing. Cleared on unmount so we
  // don't leak across page-reloads.
  useEffect(() => {
    (window as any).__openTaskDetail = (task: any) =>
      detail.openTaskDetail(task);
    return () => {
      try {
        delete (window as any).__openTaskDetail;
      } catch {
        /* ignore */
      }
    };
  }, [detail.openTaskDetail]);

  useEffect(() => {
    if (activeTab !== "sprint") return;
    const controller = new AbortController();
    setLoading(true);
    fetchTasks(controller.signal).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [fetchTasks, activeTab]);

  useEffect(() => {
    if (!currentUser?.team_id) {
      if (activeTab === "sprint") setActiveTab("backlog");
      return;
    }
    getTeamSprintConfig(currentUser.team_id).catch(() => {
      if (activeTab === "sprint") setActiveTab("backlog");
    });
  }, [currentUser?.team_id]);

  useEffect(() => {
    const today = getLocalToday();
    if (date !== today || autoCarriedRef.current === today) return;
    autoCarriedRef.current = today;
    carryForwardTasks()
      .then((res) => {
        if ((res.data as any).carried > 0) {
          setCarriedCount((res.data as any).carried);
          fetchTasks();
          setTimeout(() => setCarriedCount(0), 4000);
        }
      })
      .catch(() => setError("Failed to carry forward tasks"));
  }, [date, fetchTasks]);

  useEffect(() => {
    if (activeTab === "backlog") backlog.fetchBacklog();
  }, [activeTab, backlog.fetchBacklog]);

  // Refresh sprint stats whenever the sprint changes or its tasks update.
  useEffect(() => {
    if (activeTab !== "sprint" || !selectedSprintId) {
      setSprintStats(null);
      return;
    }
    getSprintStats(selectedSprintId)
      .then((r) => setSprintStats(r.data))
      .catch(() => setSprintStats(null));
  }, [activeTab, selectedSprintId, tasks.length, stats.done]);

  const handleDelete = (task: any) => setTaskToDelete(task);
  const confirmDeleteWithRefresh = async () => {
    if (!taskToDelete) return;
    try {
      await deleteTask(taskToDelete.id);
      setTaskToDelete(null);
      if (comments.commentTaskId === taskToDelete.id) comments.closeComments();
      if (detail.detailTask?.id === taskToDelete.id) detail.closeTaskDetail();
      fetchTasks();
      if (activeTab === "backlog") backlog.fetchBacklog();
    } catch {
      setError("Failed to delete item");
    }
  };

  const handleToggleDone = (task: any) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    const label = newStatus === "done" ? "Mark as done" : "Mark as incomplete";
    showConfirm(
      label,
      `${label}: "${task.title}"?`,
      async () => {
        closeConfirm();
        try {
          await updateTaskStatus(task.id, newStatus);
          fetchTasks();
        } catch {
          setError("Failed to update task");
        }
      },
      { confirmText: label },
    );
  };

  const handleSummaryTotal = () => {
    filters.setFiltersOpen(true);
    filters.setFilterPriority("");
    filters.setFilterStatus("");
  };
  const handleSummaryPriority = (value: string) => {
    filters.setFiltersOpen(true);
    filters.setFilterPriority((prev: string) => (prev === value ? "" : value));
  };
  const toggleLabel = (labelId: any, list: any, setter: any) => {
    setter((prev: any[]) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };
  const getColTasks = (colId: string) => tasks.filter((t) => t.status === colId);
  const isToday = date === getLocalToday();
  const sprintMode = activeTab === "sprint";
  const summaryAllActive = !filters.filterPriority;
  return (
    <TaskProvider
      assignableUsers={assignableUsers}
      orgLabels={orgLabels}
      availableSprints={availableSprints}
      availableProjects={availableProjects}
      currentUser={currentUser}
      activeTab={activeTab}
    >
      <div className={s["tasks-page"]}>
        <TasksHeader
          activeTab={activeTab}
          setActiveTab={changeTab}
          date={date}
          setDate={setDate}
          isToday={isToday}
          selectedSprintId={selectedSprintId}
          setSelectedSprintId={setSelectedSprintId}
          backlogTasks={backlog.backlogTasks}
          filterCount={filters.filterCount}
          filtersOpen={filters.filtersOpen}
          setFiltersOpen={filters.setFiltersOpen}
          filterAssignee={filters.filterAssignee}
          setFilterAssignee={filters.setFilterAssignee}
          filterLabel={filters.filterLabel}
          setFilterLabel={filters.setFilterLabel}
          filterPriority={filters.filterPriority}
          setFilterPriority={filters.setFilterPriority}
          filterStatus={filters.filterStatus}
          setFilterStatus={filters.setFilterStatus}
          filterSearch={filters.filterSearch}
          setFilterSearch={filters.setFilterSearch}
          globalSearch={globalSearch.globalSearch}
          globalResults={globalSearch.globalResults}
          globalSearching={globalSearch.globalSearching}
          globalSearchOpen={globalSearch.globalSearchOpen}
          globalSearchRef={globalSearch.globalSearchRef}
          onGlobalSearch={globalSearch.handleGlobalSearch}
          setGlobalSearchOpen={globalSearch.setGlobalSearchOpen}
          onOpenDetail={detail.openTaskDetail}
          setBacklogFormOpen={backlog.setBacklogFormOpen}
          setSprintImportOpen={setSprintImportOpen}
          fetchBacklog={backlog.fetchBacklog}
          clearFilters={filters.clearFilters}
        />

        {activeTab === "sprint" && (
          <>
            <SprintProgressCard
              stats={stats}
              sprintStats={sprintStats}
              features={features}
              unitLabel={unitLabel}
              availableSprints={availableSprints}
              selectedSprintId={selectedSprintId}
              currentUser={currentUser}
              getColTasks={getColTasks}
              onSprintChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["tasks", "availableSprints"] });
                fetchTasks();
                if (selectedSprintId) {
                  getSprintStats(selectedSprintId).then((r) => setSprintStats(r.data)).catch(() => {});
                }
              }}
            />

            {carriedCount > 0 && (
              <div className={s["carry-banner"]}>
                <ArrowDownCircle
                  size={14}
                  style={{ marginRight: 5, verticalAlign: "middle" }}
                />
                {carriedCount} incomplete item{carriedCount > 1 ? "s" : ""} from
                yesterday carried forward automatically.
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
                onClose={() => {
                  setSprintImportOpen(false);
                  backlog.setImportConfigTask(null);
                }}
              />
            )}

            {loading ? (
              <div className="loading-spinner">
                <div className="spinner" />
              </div>
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
                onOpenDetail={detail.openTaskDetail}
                onOpenComments={comments.openComments}
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
        )}

        {activeTab === "backlog" && (
          <BacklogTab
            {...backlog}
            onQuickAdd={backlog.quickAdd}
            onInlineEdit={backlog.inlineEdit}
            selection={backlog.bulk}
            bulkBar={
              <BacklogBulkBar
                bulk={backlog.bulk}
                availableSprints={availableSprints}
                assignableUsers={assignableUsers}
                onOfferUndo={offerUndo}
              />
            }
            filterPriority={filters.filterPriority}
            summaryAllActive={summaryAllActive}
            error={error}
            onOpenDetail={detail.openTaskDetail}
            onHandleSummaryTotal={handleSummaryTotal}
            onHandleSummaryPriority={handleSummaryPriority}
            onToggleLabel={toggleLabel as any}
          />
        )}

        {activeTab === "scheduled" && (<ScheduledTab filters={filters.plannerFilters} focusDate={scheduledFocus} onFocusConsumed={() => setScheduledFocus(null)} onOpenDetail={detail.openTaskDetail} onOpenComments={comments.openComments} />)}
        {activeTab === "service-desk" && <ServiceDeskTab />}

        <InlineCommentPanel
          task={tasks.find((t) => t.id === comments.commentTaskId) || null}
          comments={comments.comments}
          commentsLoading={comments.commentsLoading}
          commentText={comments.commentText}
          setCommentText={comments.setCommentText}
          editingCommentId={comments.editingCommentId}
          setEditingCommentId={comments.setEditingCommentId}
          editCommentText={comments.editCommentText}
          setEditCommentText={comments.setEditCommentText}
          currentUser={currentUser}
          onClose={comments.closeComments}
          onAddComment={comments.handleAddComment}
          onEditComment={comments.handleEditComment}
          onDeleteComment={comments.handleDeleteComment}
        />

        <TaskDetailModal
          detailTask={detail.detailTask}
          detailComments={detail.detailComments}
          detailLoading={detail.detailLoading}
          detailEditing={detail.detailEditing}
          detailTab={detail.detailTab}
          setDetailTab={detail.setDetailTab}
          detailHistory={detail.detailHistory}
          onClose={detail.closeTaskDetail}
          onStartEdit={detail.startDetailEdit}
          onSaveEdit={detail.saveDetailEdit}
          onCancelEdit={() => detail.setDetailEditing(false)}
          onDelete={handleDelete}
          onAddComment={detail.handleAddDetailComment}
          onEditComment={detail.handleEditDetailComment}
          onDeleteComment={detail.handleDetailDeleteComment}
          onSchedule={backlog.handleScheduleTask}
          onUnschedule={backlog.handleUnscheduleTask}
          onStatusChange={detail.handleDetailStatusChange}
          showConfirm={showConfirm}
          closeConfirm={closeConfirm}
          fetchTasks={fetchTasks}
          fetchBacklog={backlog.fetchBacklog}
          setError={setError}
        />

        <ConfirmDialog
          isOpen={!!taskToDelete}
          title="Delete Item"
          message={`Are you sure you want to delete "${taskToDelete?.title}"? This cannot be undone.`}
          confirmText="Delete"
          isDanger
          onConfirm={confirmDeleteWithRefresh}
          onCancel={() => setTaskToDelete(null)}
        />

        <ConfirmDialog
          isOpen={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          isDanger={confirmDialog.isDanger}
          onConfirm={() => {
            if (confirmDialog.onConfirm) confirmDialog.onConfirm();
          }}
          onCancel={closeConfirm}
        />
      </div>
    </TaskProvider>
  );
}
