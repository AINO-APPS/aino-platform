import { Plus as ActionPlus } from "../../constants/icons";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAutoDismiss } from "../../hooks/useAutoDismiss";
import { getOrgTeams, getOrgDepartments, getOrgMembers, createTeam, updateTeam, deleteTeam } from "../../api/organization";
import s from "../../pages/Admin.module.css";
import sf from "../../pages/admin/AdminForms.module.css";
import su from "../../pages/admin/AdminUtils.module.css";

interface TeamRow {
  id: number | string;
  name: string;
  department_id?: number | string | null;
  department_name?: string;
  lead_id?: number | string | null;
  lead_name?: string;
  member_count?: number;
  [key: string]: unknown;
}

interface DepartmentRow {
  id: number | string;
  name: string;
  [key: string]: unknown;
}

interface MemberRow {
  id: number | string;
  full_name?: string;
  username?: string;
  [key: string]: unknown;
}

interface EditForm {
  name: string;
  department_id: string;
  lead_id: string;
}

interface TeamsProps {
  orgId?: number | string;
  userRole?: string;
}

const EMPTY_TEAMS: TeamRow[] = [];
const EMPTY_DEPARTMENTS: DepartmentRow[] = [];
const EMPTY_MEMBERS: MemberRow[] = [];

export default function Teams({ orgId, userRole }: TeamsProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    department_id: "",
    lead_id: "",
  });
  const [editId, setEditId] = useState<number | string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    department_id: "",
    lead_id: "",
  });
  const [msg, setMsg] = useAutoDismiss("");
  const canManage = ["hr_admin", "super_admin", "platform_admin"].includes(
    userRole ?? "",
  );
  const isAdmin = canManage;

  const { data: teamsData } = useQuery({
    queryKey: ["admin", "teams", orgId],
    queryFn: async (): Promise<{
      teams: TeamRow[];
      departments: DepartmentRow[];
    }> => {
      const [teamsRes, deptsRes] = await Promise.all([
        getOrgTeams(orgId ? { org_id: orgId } : undefined),
        getOrgDepartments(orgId ? { org_id: orgId } : undefined),
      ]);
      return { teams: teamsRes.data, departments: deptsRes.data };
    },
  });
  const teams = teamsData?.teams ?? EMPTY_TEAMS;
  const departments = teamsData?.departments ?? EMPTY_DEPARTMENTS;

  const { data: members = EMPTY_MEMBERS } = useQuery({
    queryKey: ["admin", "members", orgId],
    queryFn: async (): Promise<MemberRow[]> => {
      const r = await getOrgMembers(
        orgId ? { is_active: true, org_id: orgId } : { is_active: true },
      );
      return r.data?.data ?? r.data;
    },
    enabled: canManage,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createTeam({
        name: form.name,
        department_id: form.department_id || null,
        lead_id: form.lead_id || null,
        org_id: orgId || undefined,
      });
      setForm({ name: "", department_id: "", lead_id: "" });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (e: any) {
      setMsg(e.response?.data?.error || "Failed");
    }
  };

  const handleUpdate = async (id: number | string) => {
    try {
      await updateTeam(id, {
        name: editForm.name,
        department_id: editForm.department_id || null,
        lead_id: editForm.lead_id || null,
      });
      setEditId(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (e: any) {
      setMsg(e.response?.data?.error || "Failed");
    }
  };

  const handleDelete = async (id: number | string) => {
    if (!confirm("Delete this team? Members will be unassigned.")) return;
    try {
      await deleteTeam(id);
      queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
    } catch (e: any) {
      setMsg(e.response?.data?.error || "Failed");
    }
  };

  return (
    <>
      {msg && <div className={s.success}>{msg}</div>}
      {canManage && (
        <div className={su["form-toolbar"]}>
          {showForm ? (
            <form onSubmit={handleCreate} className={su["inline-form"]}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Team name"
                required
                className={su["form-inline-input"]}
              />
              <select
                value={form.department_id}
                onChange={(e) =>
                  setForm({ ...form, department_id: e.target.value })
                }
                className={su["form-inline-input"]}
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                value={form.lead_id}
                onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
                className={su["form-inline-input"]}
              >
                <option value="">No Lead</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.username}
                  </option>
                ))}
              </select>
              <button type="submit" className={s.btnPrimary}>
                Add
              </button>
              <button
                type="button"
                className={sf.btnCancel}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button className={s.btnPrimary} onClick={() => setShowForm(true)}>
              <ActionPlus size="1em" /> Add Team
            </button>
          )}
        </div>
      )}
      <table className={s.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Department</th>
            <th>Lead</th>
            {isAdmin && <th>Members</th>}
            {canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <React.Fragment key={t.id}>
              <tr>
                <td>
                  {editId === t.id ? (
                    <input
                      value={editForm.name}
                      onChange={(e) =>
                        setEditForm({ ...editForm, name: e.target.value })
                      }
                      className={su["edit-inline-input"]}
                    />
                  ) : (
                    t.name
                  )}
                </td>
                <td>
                  {editId === t.id ? (
                    <select
                      value={editForm.department_id}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          department_id: e.target.value,
                        })
                      }
                      className={su["edit-inline-input"]}
                    >
                      <option value="">No department</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t.department_name || "—"
                  )}
                </td>
                <td>
                  {editId === t.id ? (
                    <select
                      value={editForm.lead_id}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          lead_id: e.target.value,
                        })
                      }
                      className={su["edit-inline-input"]}
                    >
                      <option value="">No Lead</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name || m.username}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t.lead_name || "—"
                  )}
                </td>
                {isAdmin && <td>{t.member_count}</td>}
                {canManage && (
                  <td>
                    <div className={s.actions}>
                      {editId === t.id ? (
                        <>
                          <button
                            className={`${s.btnSmall} ${s.btnAccent}`}
                            onClick={() => handleUpdate(t.id)}
                          >
                            Save
                          </button>
                          <button
                            className={`${s.btnSmall} ${s.btnSecondary}`}
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={`${s.btnSmall} ${s.btnAccent}`}
                            onClick={() => {
                              setEditId(t.id);
                              setEditForm({
                                name: t.name,
                                department_id: t.department_id
                                  ? String(t.department_id)
                                  : "",
                                lead_id: t.lead_id ? String(t.lead_id) : "",
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className={`${s.btnSmall} ${s.btnDanger}`}
                            onClick={() => handleDelete(t.id)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            </React.Fragment>
          ))}
          {teams.length === 0 && (
            <tr>
              <td
                colSpan={3 + (isAdmin ? 1 : 0) + (canManage ? 1 : 0)}
                className={s.emptyRow}
              >
                No teams yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
