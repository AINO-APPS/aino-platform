import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProjectMembers,
  grantProjectMember,
  removeProjectMember,
  updateProjectMember,
} from "../../api/tasks";
import { useToast } from "../common/Toast";

const ROLES = [
  { value: "project_admin", label: "Project admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

interface ProjectMembersProps {
  projectId: number | string;
  canManageMembers: boolean;
  users: any[];
  teams: any[];
}

export default function ProjectMembers({
  projectId,
  canManageMembers,
  users,
  teams,
}: ProjectMembersProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [subjectType, setSubjectType] = useState<"user" | "team">("user");
  const [subjectId, setSubjectId] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);

  const queryKey = ["admin", "project-members", projectId];
  const { data: members = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => ((await getProjectMembers(projectId)).data as any[]) || [],
  });

  function displayName(member: any): string {
    return member.user_name || member.username || member.team_name || "Unknown member";
  }

  async function refreshMembers() {
    await queryClient.invalidateQueries({ queryKey });
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!subjectId) return;
    try {
      setSaving(true);
      await grantProjectMember(projectId, {
        subject_type: subjectType,
        subject_id: Number(subjectId),
        role,
      });
      setSubjectId("");
      await refreshMembers();
      toast.success("Project access granted");
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to grant project access");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: any, nextRole: string) {
    try {
      await updateProjectMember(projectId, member.id, nextRole);
      await refreshMembers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to update project role");
    }
  }

  async function removeMember(member: any) {
    try {
      await removeProjectMember(projectId, member.id);
      await refreshMembers();
      toast.success("Project access removed");
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to remove project access");
    }
  }

  const subjects = subjectType === "user" ? users : teams;
  return (
    <section aria-labelledby="project-members-title" style={styles.section}>
      <header style={styles.header}>
        <h3 id="project-members-title" style={styles.title}>Members</h3>
        <span>{members.length} grant{members.length === 1 ? "" : "s"}</span>
      </header>
      {canManageMembers && (
        <form onSubmit={addMember} style={styles.form}>
          <label style={styles.label}>
            <span>Grant to</span>
            <select
              aria-label="Member type"
              value={subjectType}
              onChange={(event) => {
                setSubjectType(event.target.value as "user" | "team");
                setSubjectId("");
              }}
            >
              <option value="user">Person</option>
              <option value="team">Team</option>
            </select>
          </label>
          <label style={styles.label}>
            <span>{subjectType === "user" ? "Person" : "Team"}</span>
            <select
              aria-label={subjectType === "user" ? "Person" : "Team"}
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              required
            >
              <option value="">Choose {subjectType === "user" ? "a person" : "a team"}</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.full_name || subject.name || subject.username}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            <span>Role</span>
            <select aria-label="New member role" value={role} onChange={(event) => setRole(event.target.value)}>
              {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!subjectId || saving}>
            {saving ? "Saving…" : "Add member"}
          </button>
        </form>
      )}
      {isLoading ? (
        <p>Loading members…</p>
      ) : members.length === 0 ? (
        <p>No project members have been added.</p>
      ) : (
        <ul style={styles.list}>
          {members.map((member: any) => (
            <li key={member.id} style={styles.row}>
              <span>{displayName(member)}{member.team_id ? " (team)" : ""}</span>
              {canManageMembers ? (
                <>
                  <select
                    aria-label={`Role for ${displayName(member)}`}
                    value={member.role}
                    onChange={(event) => void changeRole(member, event.target.value)}
                  >
                    {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" onClick={() => void removeMember(member)} aria-label={`Remove ${displayName(member)}`}>
                    Remove
                  </button>
                </>
              ) : (
                <span>{ROLES.find((option) => option.value === member.role)?.label || member.role}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: { padding: 14, borderBottom: "1px solid var(--border, #2a2f3a)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  title: { margin: 0, fontSize: 15 },
  form: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", margin: "12px 0" },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 },
  list: { listStyle: "none", padding: 0, margin: "8px 0 0" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderTop: "1px solid var(--border-subtle, #1f232b)",
  },
};
