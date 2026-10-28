/**
 * Shared client-side domain types.
 *
 * These describe the core entities that flow through the frontend — users,
 * tasks, sprints, leaves, chat, etc. They mirror the API response shapes
 * produced by the server. They are intentionally permissive where the legacy
 * JS is permissive, and will be tightened over time as components are migrated.
 *
 * Index signatures (`[key: string]: unknown`) are included on several types so
 * that fields not yet enumerated here do not cause type errors during the
 * incremental migration.
 */

/** Generic record alias used throughout the app for loosely-typed objects. */
export type AnyRecord = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* User & auth                                                         */
/* ------------------------------------------------------------------ */

export interface User {
    id: number;
    username?: string;
    full_name?: string;
    email?: string;
    avatar?: string | null;
    role?: string;
    role_level?: number;
    org_id?: number;
    tenant_id?: number | null;
    tenant_plan?: string;
    tenant_features?: Record<string, boolean> | null;
    has_reports?: boolean;
    has_linked_realm?: boolean;
    platform_role?: string;
    impersonated?: boolean;
    impersonated_by_name?: string | null;
    impersonated_tenant_name?: string | null;
    team_id?: number | null;
    team_name?: string | null;
    /**
     * The caller's team has sprint config (an admin set a start date), so the
     * team plans in sprints rather than on dated work. Not the tenant's agile
     * feature, and not derivable from the sprint list, which is materialised
     * lazily.
     */
    team_sprint_enabled?: boolean;
    [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Tasks / agile                                                       */
/* ------------------------------------------------------------------ */

// Canonical task and sprint shapes are generated from contracts/openapi.json.
// A field rename or removal in the contract changes these types, so the build
// fails instead of the running product. Legacy aliases stay optional here
// until ticket 28 removes them.
import type {
    Task as GeneratedTask,
    Sprint as GeneratedSprint,
    SprintBaseline as GeneratedSprintBaseline,
    TaskListResponse as GeneratedTaskListResponse,
    BacklogResponse as GeneratedBacklogResponse,
} from "./generated/tasks";

export type {
    GeneratedTask,
    GeneratedSprint,
    GeneratedSprintBaseline,
    GeneratedTaskListResponse,
    GeneratedBacklogResponse,
};

export interface Task extends GeneratedTask {
    type?: string;
    assignee_id?: number | null;
    reporter_id?: number | null;
    parent_id?: number | null;
    labels?: TaskLabel[];
    updated_at?: string;
    [key: string]: unknown;
}

export interface TaskLabel {
    id: number;
    name: string;
    color?: string;
    [key: string]: unknown;
}

export interface Sprint extends GeneratedSprint {
    project_id?: number | null;
    [key: string]: unknown;
}

export interface Project {
    id: number;
    name?: string;
    key?: string;
    description?: string | null;
    [key: string]: unknown;
}

export interface Comment {
    id: number;
    body?: string;
    author_id?: number;
    author_name?: string;
    created_at?: string;
    [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Leaves & attendance                                                 */
/* ------------------------------------------------------------------ */

export interface LeaveRequest {
    id: number;
    user_id?: number;
    type?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    reason?: string | null;
    [key: string]: unknown;
}

export interface LeaveBalance {
    type: string;
    total?: number;
    used?: number;
    remaining?: number;
    [key: string]: unknown;
}

export interface TimeEntry {
    id?: number;
    user_id?: number;
    entry_type: "clock_in" | "clock_out" | "break_start" | "break_end";
    timestamp: string;
    work_mode?: string;
    approval_status?: string;
    [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export interface Conversation {
    id: number;
    name?: string | null;
    is_group?: boolean;
    is_self_chat?: boolean;
    group_name?: string | null;
    group_avatar?: string | null;
    group_description?: string | null;
    group_member_avatars?: string[] | null;
    group_member_previews?: { name?: string | null; avatar?: string | null }[] | null;
    post_policy?: "all" | "admins" | null;
    add_policy?: "all" | "admins" | null;
    my_role?: "owner" | "admin" | "member" | null;
    member_count?: number | null;
    is_pinned?: boolean;
    is_favourite?: boolean;
    is_muted?: boolean;
    muted_until?: string | null;
    is_archived?: boolean;
    is_blocked?: boolean;
    is_meeting_chat?: boolean;
    other_full_name?: string | null;
    other_avatar?: string | null;
    other_user_id?: number | string;
    unread_count?: number;
    last_message?: ChatMessage | null;
    participants?: User[];
    [key: string]: unknown;
}

export interface ChatMessage {
    id: number;
    conversation_id?: number;
    sender_id?: number;
    body?: string;
    created_at?: string;
    [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

export interface CustomFieldDef {
    id: number;
    name: string;
    field_key?: string;
    type?: string;
    options?: unknown[];
    required?: boolean;
    [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Calendar / events                                                   */
/* ------------------------------------------------------------------ */

export interface CalendarEvent {
    id: number;
    title?: string;
    start?: string;
    end?: string | null;
    all_day?: boolean;
    [key: string]: unknown;
}