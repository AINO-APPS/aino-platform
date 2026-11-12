import SprintInsights from "./SprintInsights";
import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { getTasks, updateTaskStatus, deleteTask, getAssignableUsers, getTaskLabels, addTaskComment, updateTaskComment, getTaskDetail, assignTaskToSprint } from "../api/tasks";
import { useAgileConfig } from "../AgileConfigContext";
import { useFeatures } from "../FeaturesContext";
import ConfirmDialog from "../components/common/ConfirmDialog";
import { useAuth } from "../AuthContext";
import { useAutoDismiss } from "../hooks/useAutoDismiss";
import "highlight.js/styles/github-dark.css";

import { COLUMNS } from "./tasks/constants";
import BacklogTab from "./tasks/BacklogTab";
import TasksHeader from "./tasks/TasksHeader";
import TaskDetailModal from "./tasks/TaskDetailModal";
import InlineCommentPanel from "./tasks/InlineCommentPanel";
import ServiceDeskTab from "./tasks/ServiceDeskTab";
import BulkActionBar from "./tasks/BulkActionBar";
import BacklogBulkBar from "./tasks/BacklogBulkBar";
import SprintTab from "./tasks/SprintTab";
import ProjectBoard from "./tasks/ProjectBoard";
import TaskListView from "./tasks/TaskListView";
import TaskCalendar from "./tasks/TaskCalendar";
import { useToast } from "../components/common/Toast";
import { TaskProvider } from "./tasks/TaskContext";

import { useConfirmDialog } from "./tasks/hooks/useConfirmDialog";
import { useFilters } from "./tasks/hooks/useFilters";
import { useGlobalSearch } from "./tasks/hooks/useGlobalSearch";
import { useComments } from "./tasks/hooks/useComments";
import { useBacklog } from "./tasks/hooks/useBacklog";
import { backlogTabHandlers } from "./tasks/hooks/backlogTabProps";
import { useTaskDetail } from "./tasks/hooks/useTaskDetail";
import { useTasksRoute, showsBacklog, sprintIdFrom, tasksViewPath } from "./tasks/hooks/useTasksRoute";
import { useTasksRouteSync, useTaskDeepLink, useSprintLanding } from "./tasks/hooks/useTasksRouteSync";
import { useUndoToast } from "./tasks/hooks/useUndoToast";
import { useSprintBoard } from "./tasks/hooks/useSprintBoard";
import { useSprintBoardDrag } from "./tasks/hooks/useSprintBoardDrag";
import { useSprintStats } from "./tasks/hooks/useSprintStats";
import { useSprintPlan } from "./tasks/hooks/useSprintPlan";
import { useEpics } from "./tasks/hooks/useEpics";
import { usePlanningScope } from "./tasks/hooks/usePlanningScope";
import { useTeamSwitchNavigation } from "./tasks/hooks/useTeamSwitchNavigation";
import { useSprintBoardActions } from "./tasks/hooks/useSprintBoardActions";
import { useTaskQuickActions, useSummaryFilters, toggleLabelId } from "./tasks/hooks/useTaskQuickActions";
import TeamFallbackBanner from "./tasks/TeamFallbackBanner";
import { useTasksPalette } from "./tasks/hooks/useTasksPalette";
import { useTicketLifecycle } from "./tasks/hooks/useTicketLifecycle";
import TasksOverlays from "./tasks/TasksOverlays";
import TasksConfirmDialogs from "./tasks/TasksConfirmDialogs";
import { useTicketProjects } from "./tasks/hooks/useTicketProjects";

import s from "./Tasks.module.css";

const EMPTY: any[] = [];
export default function Tasks() {
  const { user } = useAuth() as any;
  if (user?.project_ownership !== true) return <section className="card">
    <h2>Project planning is not available yet</h2>
    <p>Your organization’s project migration must be completed before using this version of planning. Contact your administrator.</p>
  </section>;
  return <ProjectTasks />;
}

function ProjectTasks() {
  const { user: currentUser } = useAuth() as any;
  const projectOwnership = currentUser?.project_ownership === true;
  const { hasFeature } = useFeatures();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    total: 0,
    done: 0,
    inProgress: 0,
    percent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useAutoDismiss("") as [string, (v: string) => void];
  const [taskToDelete, setTaskToDelete] = useState<any>(null);
  // Tabs are real routes: the URL decides the view before the first render.
  const tasksRoute = useTasksRoute();
  const [activeTab, setActiveTab] = useState<string>(tasksRoute.route.view);
  const [selectedSprintId, setSelectedSprintId] = useState<any>(() => sprintIdFrom(tasksRoute.route.sprintId));
  const [sprintImportOpen, setSprintImportOpen] = useState(false);
  const toast = useToast() as any;
  const { data: assignableUsers = EMPTY } = useQuery({
    queryKey: ["tasks", "assignableUsers"],
    queryFn: async () => (await getAssignableUsers()).data as any[],
  });
  const { data: orgLabels = EMPTY } = useQuery({
    queryKey: ["tasks", "labels"],
    queryFn: async () => (await getTaskLabels()).data as any[],
  });
  const { availableProjects, projectsFetched, createProjects } = useTicketProjects(currentUser);
  const team = usePlanningScope({ currentUser, projects: availableProjects, projectsLoaded: projectsFetched, availableSprints: EMPTY, setSelectedSprintId, agileEnabled: hasFeature("agile") });
  const sprintsLoaded = team.currentSprintLoaded;
  const { showTeamSwitcher, orgTeams, selectedTeamId, setSelectedTeamId, visibleSprints, teamScopeParams } = team;
  const teamVisibility = hasFeature("team_visibility");

  const { sprintStats, refreshSprintStats } = useSprintStats(activeTab, selectedSprintId, tasks.length, stats.done);
  const { unitLabel, features, initialState, terminalStates, workflowStates } = useAgileConfig() as any;

  const { confirmDialog, showConfirm, closeConfirm, cancelConfirm } = useConfirmDialog() as any;
  const filters = useFilters({ activeTab }) as any;
  const globalSearch = useGlobalSearch() as any;
  const {
    columns: boardColumns,
    fetchBoard,
    clearColumns: clearBoardColumns,
    attribution: boardAttribution,
  } = useSprintBoard({
    sprintId: selectedSprintId,
    workflowStates,
    tasks,
    setTasks,
    setStats,
    enabled: activeTab === "sprint" && !tasksRoute.route.plan && selectedSprintId != null,
  });

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
          if (tasksRoute.route.plan) {
            params.sprint_id = selectedSprintId;
            const res = await getTasks(undefined as any, params, signal);
            setTasks((res.data as any).tasks);
            setStats((res.data as any).stats);
            clearBoardColumns();
          } else {
            await fetchBoard(signal);
          }
        } else {
          setTasks([]);
          clearBoardColumns();
          setStats({ total: 0, done: 0, inProgress: 0, percent: 0 });
        }
        setError("");
      } catch {
        setError("Failed to load tasks");
      } finally {
        setLoading(false);
      }
    },
    [activeTab, selectedSprintId, filters.plannerFilters, tasksRoute.route.plan, fetchBoard, clearBoardColumns],
  );

  const backlog = useBacklog({
    activeTab,
    backlogFilters: filters.backlogFilters,
    /** Team scope from the admin switcher (team_id or unassigned). */
    scopeParams: teamScopeParams,
    projectOwnership, createProjects,
    createProjectUserKey: `${currentUser?.tenant_id}.${currentUser?.id}`,
    selectedSprintId,
    showConfirm,
    closeConfirm,
    fetchTasks,
    setError,
    onMoved: () => toast.info("Moved to the sprint", 4000),
  }) as any;
  const detail = useTaskDetail({
    activeTab, planOpen: tasksRoute.route.plan, showConfirm, closeConfirm,
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
  const { drag, boardDrag, announcement: boardAnnouncement } = useSprintBoardDrag({
    tasks,
    setTasks,
    columns: boardColumns,
    showConfirm,
    closeConfirm,
    setError,
    onBoardRefresh: fetchTasks,
  });

  const sprintPlan = useSprintPlan({
    sprintId: selectedSprintId,
    fetchTasks,
    fetchBacklog: backlog.fetchBacklog,
    onError: setError, onReplaced: detail.replaceTicket,
  });

  // Epics: the rollup list and the URL-backed epic filter.
  const epics = useEpics(tasksRoute.filters.epic);

  // Landing on the bare /tasks entry point opens the server-selected current sprint.
  useSprintLanding({
    planTabs: projectOwnership ? team.selectedProject?.planTabs : undefined,
    pathname: location.pathname,
    search: location.search,
    currentSprintId: team.currentSprintId, sprintsLoaded: sprintsLoaded && team.currentSprintLoaded && (!showTeamSwitcher || selectedTeamId !== null),
    agileEnabled: hasFeature("agile"),
    navigate,
  });

  // The URL is the source of truth for the view. Legacy `?tab=` links are
  // redirected to their route so old bookmarks keep working.
  useTasksRouteSync({
    planTabs: projectOwnership ? team.selectedProject?.planTabs : undefined,
    route: tasksRoute.route,
    searchParams,
    navigate,
    setActiveTab,
    setSelectedSprintId,
    currentSprintId: team.currentSprintId, sprintsLoaded: sprintsLoaded && team.currentSprintLoaded && (!showTeamSwitcher || selectedTeamId !== null),
  });

  useTeamSwitchNavigation({
    planTabs: projectOwnership ? team.selectedProject?.planTabs : undefined,
    selectedTeamId,
    currentSprintId: team.currentSprintId, currentSprintLoaded: team.currentSprintLoaded,
    activeTab: tasksRoute.route.view,
    goToView: tasksRoute.goToView,
  });

  // Deep links to a specific task open its detail on arrival.
  useTaskDeepLink(searchParams, detail.openTaskDetail, location.pathname, navigate);

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
    if (showsBacklog(activeTab, tasksRoute.route.plan)) backlog.fetchBacklog();
  }, [activeTab, tasksRoute.route.plan, backlog.fetchBacklog]);

  const handleDelete = (task: any) => setTaskToDelete(task);

  const lifecycle = useTicketLifecycle({
    availableSprints: visibleSprints, currentSprintId: team.currentSprintId, selectedSprintId, activeTab, planOpen: tasksRoute.route.plan, showConfirm, closeConfirm,
    setError, fetchTasks, fetchBacklog: backlog.fetchBacklog, toast, onReplaced: detail.replaceTicket,
  });

  const confirmDeleteWithRefresh = async () => {
    if (!taskToDelete) return;
    const target = taskToDelete;
    setTaskToDelete(null);
    if (comments.commentTaskId === target.id) comments.closeComments();
    if (detail.detailTask?.id === target.id) detail.closeTaskDetail();
    await lifecycle.cancelTicket(target);
  };

  const { toggleDone } = useTaskQuickActions({
    showConfirm, closeConfirm, fetchTasks, setError, initialState, terminalStates,
  });

  const { showTotal: handleSummaryTotal, showPriority: handleSummaryPriority } = useSummaryFilters(filters);
  const toggleLabel = toggleLabelId;
  const getColTasks = (colId: string) => tasks.filter((t) => t.workflow_state_key === colId);
  const sprintMode = activeTab === "sprint";
  const summaryAllActive = !filters.filterPriority;

  // One keyboard entry point for tasks, views and actions, plus the `?` help
  // overlay that documents the complete shortcut set.
  const tasksPalette = useTasksPalette({
    planTabs: projectOwnership ? team.selectedProject?.planTabs : undefined,
    sprintId: selectedSprintId,
    currentSprintId: team.currentSprintId,
    agileEnabled: hasFeature("agile"),
    onOpenTask: (task) => detail.openTaskDetail(task),
    onGoToView: (view, sprintId) => {
      changeTab(view);
      if (view === "sprint" && sprintId) setSelectedSprintId(sprintId);
    },
    onNewTask: () => {
      changeTab("backlog");
      backlog.setBacklogFormOpen(true);
    },
    onToggleCompleted: () => backlog.toggleCompleted(),
    onToggleDensity: () =>
      backlog.setCardDensity(
        backlog.cardDensity === "compact" ? "comfortable" : "compact",
      ),
  });
  const palette = tasksPalette.palette;

  const sprintActions = useSprintBoardActions({
    visibleSprints,
    currentSprintId: team.currentSprintId,
    selectedSprintId,
    teamScopeParams,
    currentUser,
    setSelectedSprintId,
    goToView: tasksRoute.goToView,
    fetchTasks,
    setError,
    toast,
  });

  return (
    <TaskProvider onStatusChange={detail.handleDetailStatusChange}
      assignableUsers={assignableUsers}
      orgLabels={orgLabels}
      availableSprints={visibleSprints} currentSprintId={team.currentSprintId}
      availableProjects={availableProjects}
      currentUser={currentUser}
      activeTab={activeTab}
      cardDensity={backlog.cardDensity}
    >
      <div className={s["tasks-page"]}>
        <TasksHeader
          activeTab={activeTab}
          setActiveTab={changeTab}
          selectedSprintId={selectedSprintId}
          setSelectedSprintId={setSelectedSprintId}
          backlogTasks={backlog.backlogTasks}
          filterCount={filters.filterCount}
          filtersOpen={filters.filtersOpen}
          cardDensity={backlog.cardDensity}
          setCardDensity={backlog.setCardDensity}
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
          teams={orgTeams}
          selectedTeamId={selectedTeamId}
          onTeamChange={(value) => setSelectedTeamId(value)}
          showTeamSwitcher={showTeamSwitcher}
          projectOwnership={projectOwnership}
          projects={availableProjects}
          selectedProjectId={team.selectedProjectId}
          onProjectChange={team.changeProject}
          onPlanSprint={sprintActions.planSprint}
        />

        {!projectOwnership && <TeamFallbackBanner user={currentUser} teamVisibility={teamVisibility} />}

        {activeTab === "sprint" && selectedSprintId == null && <section className="card"><h3>No current sprint</h3><p>Plan your next sprint from the backlog.</p><button className="btn btn-secondary" onClick={() => changeTab("backlog")}>Open backlog</button></section>}
        {activeTab === "sprint" && selectedSprintId != null && (
          <SprintTab
            stats={stats}
            sprintStats={sprintStats}
            features={features}
            unitLabel={unitLabel}
            availableSprints={visibleSprints}
            selectedSprintId={selectedSprintId}
            currentUser={currentUser}
            getColTasks={getColTasks}
            onSprintChanged={() => {
              queryClient.invalidateQueries({ queryKey: ["tasks", "availableSprints"] });
              queryClient.invalidateQueries({ queryKey: ["tasks", "sprintList"] });
              fetchTasks();
              refreshSprintStats();
            }}
            error={error}
            sprintImportOpen={sprintImportOpen}
            backlog={backlog}
            assignableUsers={assignableUsers}
            onCloseImport={() => {
              setSprintImportOpen(false);
              backlog.setImportConfigTask(null);
            }}
            loading={loading}
            tasks={tasks}
            columns={boardColumns}
            drag={drag}
            sprintMode={sprintMode}
            onOpenDetail={detail.openTaskDetail}
            onOpenComments={comments.openComments}
            onAddTask={selectedSprintId ? sprintActions.addToColumn : undefined}
            boardDrag={boardDrag}
            boardAnnouncement={boardAnnouncement}
            attribution={{ ...backlog.attribution, ...boardAttribution }}
            plan={tasksRoute.route.plan}
            sprintPlan={sprintPlan}
            epics={epics.epics}
            selectedEpicId={epics.selectedEpicId}
            onSelectEpic={(id) => tasksRoute.setFilters({ epic: id ? String(id) : "" })}
            onOpenBacklog={() => changeTab("backlog")} scopeParams={teamScopeParams}
            onRetry={() => { setLoading(true); fetchTasks().finally(() => setLoading(false)); }}
          />
        )}

        {projectOwnership && team.selectedProject && (activeTab === "board" || activeTab === "backlog" && !team.selectedProject.hasSprints) && (
          <ProjectBoard key={`${team.selectedProject.id}:${activeTab}`} project={team.selectedProject} backlog={activeTab === "backlog"}
            updatedTicket={detail.detailTask} onOpenDetail={detail.openTaskDetail}
            onOpenComments={(id) => detail.openTaskDetail({ id })} showConfirm={showConfirm} closeConfirm={closeConfirm} />
        )}
        {activeTab === "backlog" && (!projectOwnership || team.selectedProject?.hasSprints) && (
          <BacklogTab
            {...backlog}
            {...backlogTabHandlers(backlog)}
            selection={backlog.bulk}
            attribution={backlog.attribution}
            bulkBar={
              <BacklogBulkBar
                bulk={backlog.bulk} tasks={backlog.backlogTasks}
                availableSprints={visibleSprints}
                assignableUsers={assignableUsers}
                onOfferUndo={offerUndo}
                onConfirmCancel={lifecycle.confirmBulkCancel}
              />
            }
            filterPriority={filters.filterPriority}
            summaryAllActive={summaryAllActive}
            error={error}
            onOpenDetail={detail.openTaskDetail}
            onAddToSprint={lifecycle.addToSprint}
            onHandleSummaryTotal={handleSummaryTotal}
            onHandleSummaryPriority={handleSummaryPriority}
            onToggleLabel={toggleLabel as any}
          />
        )}

        {projectOwnership && team.selectedProject?.type === "task_list" && activeTab === "list" && (
          <TaskListView key={team.selectedProject.id} project={team.selectedProject} updatedTicket={detail.detailTask} onOpenDetail={detail.openTaskDetail} />
        )}
        {projectOwnership && team.selectedProject?.type === "task_list" && activeTab === "calendar" && (
          <TaskCalendar key={team.selectedProject.id} project={team.selectedProject} updatedTicket={detail.detailTask} onOpenDetail={detail.openTaskDetail} />
        )}
        {activeTab === "reports" && <SprintInsights projectId={team.selectedProjectId} />}
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
          onStatusChange={detail.handleDetailStatusChange} onReplaced={detail.replaceTicket}
          showConfirm={showConfirm}
          closeConfirm={closeConfirm}
          fetchTasks={fetchTasks}
          fetchBacklog={backlog.fetchBacklog}
          setError={setError}
        />

        <TasksConfirmDialogs
          taskToCancel={taskToDelete}
          onConfirmCancel={confirmDeleteWithRefresh}
          onDismissCancel={() => setTaskToDelete(null)}
          confirmDialog={confirmDialog}
          onCancelConfirm={cancelConfirm}
        />

        <TasksOverlays
          palette={palette}
          shortcutHelpOpen={tasksPalette.shortcutHelpOpen}
          onCloseShortcutHelp={tasksPalette.closeShortcutHelp}
        />
      </div>
    </TaskProvider>
  );
}
