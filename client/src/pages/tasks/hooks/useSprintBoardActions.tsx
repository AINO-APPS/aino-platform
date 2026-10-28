import React from "react";
import { Link } from "react-router-dom";
import { addBacklogTask } from "../../../api/tasks";


/** Roles that can create and start sprints in Admin → Teams. */
const SPRINT_MANAGERS = ["team_lead", "manager", "hr_admin", "super_admin", "platform_admin"];

interface SprintActionsOptions {
    visibleSprints: any[];
    selectedSprintId: any;
    teamScopeParams: Record<string, unknown>;
    currentUser: any;
    setSelectedSprintId: (id: any) => void;
    goToView: (view: any, sprintId?: any, plan?: boolean) => void;
    fetchTasks: () => Promise<unknown> | unknown;
    setError: (message: string) => void;
    toast: any;
}

/**
 * The two sprint actions that live beside the board.
 *
 * A column "+" creates the ticket in the sprint on screen, in that column's
 * state (Jira board behaviour), never in the backlog. "Plan sprint" opens the
 * backlog-beside-sprint view for the running sprint, else the next planned
 * one; sprints are created in Admin → Teams, so with none there is only an
 * explanation to give.
 */
export function useSprintBoardActions({
    visibleSprints,
    selectedSprintId,
    teamScopeParams,
    currentUser,
    setSelectedSprintId,
    goToView,
    fetchTasks,
    setError,
    toast,
}: SprintActionsOptions) {
    const addToColumn = async (column: any) => {
        const title = window.prompt(`New ticket in ${column?.name ?? "this column"}`)?.trim();
        if (!title || !selectedSprintId) return;
        try {
            await addBacklogTask({
                ...teamScopeParams,
                title: title.slice(0, 200),
                priority: "medium",
                sprint_id: selectedSprintId,
                ...(typeof column?.id === "number" && column.id > 0 ? { workflow_state_id: column.id } : {}),
            });
            await fetchTasks();
            toast.success(`Added to ${column?.name ?? "the sprint"}`);
        } catch (err: any) {
            setError(err?.response?.data?.error || "Failed to create ticket");
        }
    };

    const planSprint = () => {
        const target =
            visibleSprints.find((sprint) => sprint.status === "active") ??
            visibleSprints.find((sprint) => sprint.status === "planned");
        if (target) {
            setSelectedSprintId(target.id);
            goToView("sprint", target.id, true);
            return;
        }
        const canManage = SPRINT_MANAGERS.includes(String(currentUser?.role));
        toast.info(
            <span>
                No sprint yet — {canManage ? "create one in " : "an admin can create one in "}
                {canManage ? <Link to="/admin?tab=teams">Admin → Teams</Link> : "Admin → Teams"}.
            </span>,
            6000,
        );
    };

    return { addToColumn, planSprint };
}
