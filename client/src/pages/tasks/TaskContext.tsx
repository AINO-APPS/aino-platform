import { createContext, useContext, useMemo } from "react";
import type { User, TaskLabel, Sprint, Project } from "../../types";

/** How much a card shows. Comfortable adds assignee and priority to the key,
 *  title and points that compact keeps. */
export type CardDensity = "comfortable" | "compact";

/**
 * Shared context for the Tasks page.
 * Eliminates prop-drilling of static/rarely-changing reference data
 * (users, labels, sprints, current user, active tab) through TasksHeader,
 * BacklogTab, and TaskDetailModal.
 */
interface TaskContextValue {
    onStatusChange?: (task: any, target: { id: string; label: string }) => void;
    assignableUsers: User[];
    orgLabels: TaskLabel[];
    availableSprints: Sprint[];
    currentSprintId: number | string | null;
    availableProjects: Project[];
    currentUser: User | null;
    activeTab: string;
    /** Per-user card density, applied consistently on every surface. */
    cardDensity: CardDensity;
}

const TaskContext = createContext<TaskContextValue | null>(null);

interface TaskProviderProps {
    onStatusChange?: (task: any, target: { id: string; label: string }) => void;
    children: React.ReactNode;
    assignableUsers: User[];
    orgLabels: TaskLabel[];
    availableSprints: Sprint[];
    currentSprintId?: number | string | null;
    availableProjects: Project[];
    currentUser: User | null;
    activeTab: string;
    cardDensity?: CardDensity;
}

export function TaskProvider({
    onStatusChange,
    children,
    assignableUsers,
    orgLabels,
    availableSprints,
    currentSprintId = null,
    availableProjects,
    currentUser,
    activeTab,
    cardDensity = "compact",
}: TaskProviderProps) {
    const value = useMemo(
        () => ({
            onStatusChange,
            assignableUsers,
            orgLabels,
            availableSprints,
            currentSprintId,
            availableProjects,
            currentUser,
            activeTab,
            cardDensity,
        }),
        [
            onStatusChange,
            assignableUsers,
            orgLabels,
            availableSprints,
            currentSprintId,
            availableProjects,
            currentUser,
            activeTab,
            cardDensity,
        ],
    );
    return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export const useTaskCtx = () => useContext(TaskContext);

/** The card density for the current Tasks view, defaulting to compact. */
export function useCardDensity(): CardDensity {
    return useTaskCtx()?.cardDensity ?? "compact";
}