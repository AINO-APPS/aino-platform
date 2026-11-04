import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getProjectTasks } from "../../api/tasks";
import Pagination from "../common/Pagination";
import { X } from "../../constants/icons";
import ProjectMembers from "./ProjectMembers";

interface ProjectTasksPanelProps {
  project: any;
  users: any[];
  teams: any[];
  onClose: () => void;
}

export default function ProjectTasksPanel({ project, users, teams, onClose }: ProjectTasksPanelProps) {
  const projectId = project.id;
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [projectId, limit]);

  const { data: tasksData, isLoading: loading } = useQuery({
    queryKey: ["admin", "project-tasks", projectId, limit, offset],
    queryFn: async () => {
      const d = (await getProjectTasks(projectId, { limit, offset } as any)).data as any;
      return {
        tasks: (d?.tasks as any[]) || [],
        total: d?.pagination?.total ?? (d?.tasks?.length || 0),
      };
    },
  });
  const tasks = tasksData?.tasks ?? [];
  const total = tasksData?.total ?? 0;

  return (
    <div style={styles.panel}>
      <ProjectMembers
        projectId={projectId}
        canManageMembers={Boolean(project.capabilities?.canManageMembers)}
        users={users}
        teams={teams}
      />
      <header style={styles.panelHeader}>
        <strong>Tasks in this project</strong>
        <button style={styles.iconBtn} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      {loading ? (
        <div style={{ padding: 16 }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: 16, color: "#9ca3af" }}>
          No tasks yet. Create a task and assign it to this project.
        </div>
      ) : (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Key</th>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task: any) => (
                <tr key={task.id}>
                  <td style={styles.tdKey}>
                    <Link
                      to={`/tasks?task=${task.id}`}
                      style={styles.taskLink}
                      title={`Open ${task.issue_key || `#${task.id}`}`}
                    >
                      <code>{task.issue_key || `#${task.id}`}</code>
                    </Link>
                  </td>
                  <td style={styles.td}>
                    <Link to={`/tasks?task=${task.id}`} style={styles.taskLink}>
                      {task.title}
                    </Link>
                  </td>
                  <td style={styles.td}>{task.workflow_state_key || "—"}</td>
                  <td style={styles.td}>
                    {task.assignee?.full_name || task.assignee?.username || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            total={total}
            limit={limit}
            offset={offset}
            onPageChange={setOffset}
            onLimitChange={setLimit}
            pageSizeOptions={[10, 25, 50, 100]}
            compact
            itemLabel="task"
          />
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: 20,
    border: "1px solid var(--border, #2a2f3a)",
    borderRadius: 12,
    background: "var(--card-bg, #1a1d24)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border, #2a2f3a)",
  },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    padding: 0,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    fontWeight: 600,
    color: "var(--text-secondary, #9ca3af)",
    borderBottom: "1px solid var(--border, #2a2f3a)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-subtle, #1f232b)",
  },
  tdKey: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-subtle, #1f232b)",
    fontFamily: "monospace",
    fontSize: 12,
  },
  taskLink: {
    color: "var(--accent, #2383e2)",
    textDecoration: "none",
    cursor: "pointer",
  },
};
