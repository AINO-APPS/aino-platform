import type { AxiosRequestConfig } from "axios";
import API, { type AnyData, type Params } from "./client";

// Service Desk
export const getServiceDeskTickets = (params?: Params) =>
    API.get("/service-desk/tickets", { params });
export const getServiceDeskTicket = (id: number | string) =>
    API.get(`/service-desk/tickets/${id}`);
export const createServiceDeskTicket = (data: AnyData) => API.post("/service-desk/tickets", data);
export const updateServiceDeskTicket = (id: number | string, data: AnyData) =>
    API.patch(`/service-desk/tickets/${id}`, data);
export const deleteServiceDeskTicket = (id: number | string) =>
    API.delete(`/service-desk/tickets/${id}`);
export const getServiceDeskStats = () => API.get("/service-desk/stats");

// Profile
export const getProfile = (config?: AxiosRequestConfig) => API.get("/profile", config);
export const updateProfile = (data: AnyData) => API.put("/profile", data);
export const updateEmail = (email: string) => API.put("/profile/email", { email });
export const updatePassword = (data: AnyData) => API.put("/profile/password", data);
export const deleteAccount = (password: string) =>
    API.delete("/profile", { data: { password } });
export const uploadAvatar = (file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return API.post("/profile/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" },
    });
};
export const removeAvatar = () => API.delete("/profile/avatar");

// Notification & sound preferences
export const getNotificationPrefs = () => API.get("/profile/notification-prefs");
export const updateNotificationPrefs = (prefs: AnyData) =>
    API.put("/profile/notification-prefs", prefs);

// ==================== ENTERPRISE API ====================

// Organization
export const createOrg = (name: string) => API.post("/org", { name });
export const getCurrentOrg = () => API.get("/org/current");
export const updateOrgSettings = (data: AnyData) => API.put("/org/settings", data);
export const getOrgMembers = (params?: Params) => API.get("/org/members", { params });
export const inviteToOrg = (data: AnyData) => API.post("/org/invite", data);
export const removeMember = (userId: number | string) =>
    API.post("/org/remove-member", { user_id: userId });
export const getOrgDepartments = (params?: Params) => API.get("/org/departments", { params });
export const createDepartment = (data: AnyData) => API.post("/org/departments", data);
export const updateDepartment = (id: number | string, data: AnyData) =>
    API.put(`/org/departments/${id}`, data);
export const deleteDepartment = (id: number | string) => API.delete(`/org/departments/${id}`);
export const getOrgTeams = (params?: Params) => API.get("/org/teams", { params });
export const createTeam = (data: AnyData) => API.post("/org/teams", data);
export const updateTeam = (id: number | string, data: AnyData) => API.put(`/org/teams/${id}`, data);
export const deleteTeam = (id: number | string) => API.delete(`/org/teams/${id}`);
export const getTeamSprintConfig = (teamId: number | string) =>
    API.get(`/org/teams/${teamId}/sprint-config`);
export const updateTeamSprintConfig = (teamId: number | string, data: AnyData) =>
    API.put(`/org/teams/${teamId}/sprint-config`, data);
export const getOrgChart = (params?: Params) => API.get("/org/chart", { params });

// Custom Roles (tenant-defined roles with permission_level 1..4)
export const getOrgRoles = (params?: Params) => API.get("/org/roles", { params });
export const createOrgRole = (data: AnyData) => API.post("/org/roles", data);
export const updateOrgRole = (roleKey: string, data: AnyData) =>
    API.patch(`/org/roles/${roleKey}`, data);
export const deleteOrgRole = (roleKey: string, params?: Params) =>
    API.delete(`/org/roles/${roleKey}`, { params });

// Admin
export const getAdminOrganizations = () => API.get("/admin/organizations");
export const getAdminOrganization = (id: number | string) =>
    API.get(`/admin/organizations/${id}`);
export const createAdminOrganization = (data: AnyData) => API.post("/admin/organizations", data);
export const updateAdminOrganization = (id: number | string, data: AnyData) =>
    API.put(`/admin/organizations/${id}`, data);
export const deleteAdminOrganization = (id: number | string) =>
    API.delete(`/admin/organizations/${id}`);
export const getAdminUsers = (params?: Params) => API.get("/admin/users", { params });
export const getAdminUser = (id: number | string) => API.get(`/admin/users/${id}`);
export const createAdminUser = (data: AnyData) => API.post("/admin/users", data);
export const updateUserRole = (id: number | string, role: string, reason?: string) =>
    API.put(`/admin/users/${id}/role`, { role, reason });
export const updateUserAssignment = (id: number | string, data: AnyData) =>
    API.put(`/admin/users/${id}/assignment`, data);
export const toggleUserActive = (id: number | string) =>
    API.put(`/admin/users/${id}/deactivate`);
export const deleteAdminUser = (id: number | string) => API.delete(`/admin/users/${id}`);
export const adminResetPassword = (id: number | string, password: string) =>
    API.post(`/admin/users/${id}/reset-password`, { new_password: password });
export const getRoleChangeRequests = (params?: Params) =>
    API.get("/admin/role-requests", { params });
export const approveRoleChange = (id: number | string) =>
    API.post(`/admin/role-requests/${id}/approve`);
export const rejectRoleChange = (id: number | string, reason?: string) =>
    API.post(`/admin/role-requests/${id}/reject`, { reject_reason: reason });
export const cancelRoleChange = (id: number | string) =>
    API.post(`/admin/role-requests/${id}/cancel`);
export const getAuditLogs = (params?: Params) => API.get("/admin/audit-logs", { params });
export const getAdminStats = () => API.get("/admin/stats");
export const getAdminTaskLabels = () => API.get("/admin/task-labels");
export const createAdminTaskLabel = (data: AnyData) => API.post("/admin/task-labels", data);
export const updateAdminTaskLabel = (id: number | string, data: AnyData) =>
    API.put(`/admin/task-labels/${id}`, data);
export const deleteAdminTaskLabel = (id: number | string) =>
    API.delete(`/admin/task-labels/${id}`);
export const getAdminAnnouncements = () => API.get("/admin/announcements");
export const createAnnouncement = (data: AnyData) => API.post("/admin/announcements", data);
export const updateAnnouncement = (id: number | string, data: AnyData) =>
    API.put(`/admin/announcements/${id}`, data);
export const deleteAnnouncement = (id: number | string) =>
    API.delete(`/admin/announcements/${id}`);

// â”€â”€â”€ Platform-Access (consent-gated impersonation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Platform-side (the inspector â€” runs while authenticated as platform_admin):
export const createTenantAccessRequest = (tenantId: number | string, data: AnyData) =>
    API.post(`/admin/tenants/${tenantId}/access-requests`, data);
export const listMyAccessRequests = (params?: Params) =>
    API.get("/admin/tenants/access-requests", { params });
export const listTenantAccessRequests = (tenantId: number | string) =>
    API.get(`/admin/tenants/${tenantId}/access-requests`);
export const cancelAccessRequest = (id: number | string) =>
    API.delete(`/admin/tenants/access-requests/${id}`);
export const getImpersonationPolicy = () => API.get("/admin/tenants/impersonation-policy");
export const updateImpersonationPolicy = (data: AnyData) =>
    API.put("/admin/tenants/impersonation-policy", data);

// Tenant-side (the approver â€” runs while authenticated as super_admin):
export const listIncomingAccessRequests = (params?: Params) =>
    API.get("/platform-access", { params });
export const approveAccessRequest = (id: number | string) =>
    API.post(`/platform-access/${id}/approve`);
export const denyAccessRequest = (id: number | string, reason?: string) =>
    API.post(`/platform-access/${id}/deny`, { reason });
export const revokeAccessSession = (id: number | string, reason?: string) =>
    API.post(`/platform-access/${id}/revoke`, { reason });
export const getActiveInspectorSession = () => API.get("/platform-access/active-session");

// Tenant Management (platform_admin)
export const getTenants = (params?: Params) => API.get("/admin/tenants", { params });
export const getTenantOverview = () => API.get("/admin/tenants/overview");
export const getTenant = (id: number | string) => API.get(`/admin/tenants/${id}`);
export const createTenant = (data: AnyData) => API.post("/admin/tenants", data);
export const updateTenant = (id: number | string, data: AnyData) =>
    API.put(`/admin/tenants/${id}`, data);
export const suspendTenant = (id: number | string, reason?: string, password?: string) =>
    API.put(`/admin/tenants/${id}/suspend`, { reason, password });
export const reactivateTenant = (id: number | string) =>
    API.put(`/admin/tenants/${id}/reactivate`);
export const deleteTenantApi = (id: number | string, hard?: boolean, password?: string) =>
    API.delete(`/admin/tenants/${id}`, { params: { hard }, data: { password } });
export const getTenantStats = (id: number | string) => API.get(`/admin/tenants/${id}/stats`);
export const updateTenantDomain = (id: number | string, domain: string) =>
    API.put(`/admin/tenants/${id}/domain`, { custom_domain: domain });
export const updateTenantFeatures = (id: number | string, features: unknown) =>
    API.put(`/admin/tenants/${id}/features`, { features });
export const updateTenantLimits = (id: number | string, limits: AnyData) =>
    API.put(`/admin/tenants/${id}/limits`, limits);
// The consent-gated flow needs to send { approval_code, password, break_glass }
// in the body. The old single-argument signature dropped the body silently,
// which made every modal submission hit the server with no password and
// fail with 400 REAUTH_REQUIRED.
export const impersonateTenant = (id: number | string, body?: AnyData) =>
    API.post(`/admin/tenants/${id}/impersonate`, body || {});
export const exitImpersonation = (id: number | string) =>
    API.post(`/admin/tenants/${id}/exit-impersonate`);
export const getImpersonationSession = (id: number | string) =>
    API.get(`/admin/tenants/${id}/impersonation-session`);
export const getTenantUsers = (id: number | string, params?: Params) =>
    API.get(`/admin/tenants/${id}/users`, { params });
export const createTenantUser = (id: number | string, data: AnyData) =>
    API.post(`/admin/tenants/${id}/users`, data);
export const deactivateTenantUser = (tenantId: number | string, userId: number | string) =>
    API.put(`/admin/tenants/${tenantId}/users/${userId}/deactivate`);
export const seedTenant = (id: number | string) => API.post(`/admin/tenants/${id}/seed`);
export const getPlatformAuditLogs = (params?: Params) =>
    API.get("/admin/tenants/audit-logs", { params });
export const getPlanCatalog = () => API.get("/admin/tenants/plan-catalog");
export const updatePlanCatalog = (plans: unknown) =>
    API.put("/admin/tenants/plan-catalog", { plans });
export const resetPlanCatalog = () => API.post("/admin/tenants/plan-catalog/reset");
export const updateTenantPlan = (
    id: number | string,
    plan: string,
    applyPlanLimits?: boolean
) => API.put(`/admin/tenants/${id}/plan`, { plan, apply_plan_limits: applyPlanLimits });

// Platform Admin Management (platform_admin)
export const getPlatformUsers = () => API.get("/admin/tenants/platform-users");
export const getPlatformUserLinks = (id: number | string) => API.get(`/admin/tenants/platform-users/${id}/links`);
export const createPlatformUserLink = (id: number | string, data: AnyData) => API.post(`/admin/tenants/platform-users/${id}/links`, data);
export const deletePlatformUserLink = (id: number | string, tenantId: number | string) => API.delete(`/admin/tenants/platform-users/${id}/links/${tenantId}`);
export const createPlatformUser = (data: AnyData) =>
    API.post("/admin/tenants/platform-users", data);
export const deactivatePlatformUser = (id: number | string) =>
    API.put(`/admin/tenants/platform-users/${id}/deactivate`);
export const resetPlatformUserPassword = (id: number | string, new_password: string) =>
    API.post(`/admin/tenants/platform-users/${id}/reset-password`, { new_password });

// Platform Configuration (platform_admin)
export const getPlatformConfig = () => API.get("/admin/tenants/platform-config");
export const updatePlatformConfig = (data: AnyData) =>
    API.put("/admin/tenants/platform-config", data);
export const getTenantAlerts = () => API.get("/admin/tenants/alerts");

// Manager Dashboard
export const getTeamAttendance = (date?: string) =>
    API.get("/manager/team-attendance", { params: { date } });
export const getTeamAnalytics = (days?: number, from?: string, to?: string) =>
    API.get("/manager/team-analytics", { params: { days, from, to } });
export const getApprovals = (params?: Params) => API.get("/manager/approvals", { params });
export const getMyRequests = (params?: Params) => API.get("/manager/my-requests", { params });
export const approveRequest = (id: number | string) =>
    API.post(`/manager/approvals/${id}/approve`);
export const rejectRequest = (id: number | string, reason?: string) =>
    API.post(`/manager/approvals/${id}/reject`, { reject_reason: reason });
export const bulkApproval = (ids: unknown, action: string, reason?: string) =>
    API.post("/manager/approvals/bulk", { ids, action, reject_reason: reason });
export const getMemberHours = (userId: number | string, from?: string, to?: string) =>
    API.get(`/manager/member/${userId}/hours`, { params: { from, to } });
export const getMemberTasks = (userId: number | string, date?: string) =>
    API.get(`/manager/member/${userId}/tasks`, { params: { date } });
export const getMemberLeaves = (userId: number | string, from?: string, to?: string) =>
    API.get(`/manager/member/${userId}/leaves`, { params: { from, to } });
export const getMemberRequests = (userId: number | string) =>
    API.get(`/manager/member/${userId}/requests`);
export const getMemberOverview = (userId: number | string) =>
    API.get(`/manager/member/${userId}/overview`);

// Leave Policy
export const getLeavePolicies = () => API.get("/leave-policy/policies");
export const saveLeavePolicyAPI = (data: AnyData) => API.post("/leave-policy/policies", data);
export const deleteLeavePolicyAPI = (id: number | string) =>
    API.delete(`/leave-policy/policies/${id}`);
export const getLeaveBalances = (year?: number) =>
    API.get("/leave-policy/balances", { params: { year } });
export const getUserLeaveBalances = (userId: number | string, year?: number) =>
    API.get(`/leave-policy/balances/${userId}`, { params: { year } });
export const updateLeaveBalance = (userId: number | string, data: AnyData) =>
    API.put(`/leave-policy/balances/${userId}`, data);
export const getHolidays = (year?: number) =>
    API.get("/leave-policy/holidays", { params: { year } });
export const addHoliday = (data: AnyData) => API.post("/leave-policy/holidays", data);
export const addHolidaysBatch = (holidays: unknown) =>
    API.post("/leave-policy/holidays/batch", { holidays });
export const deleteHoliday = (id: number | string) => API.delete(`/leave-policy/holidays/${id}`);
