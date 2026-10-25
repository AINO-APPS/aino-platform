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
    assignableUsers: User[];
    orgLabels: TaskLabel[];
    availableSprints: Sprint[];
    availableProjects: Project[];
    currentUser: User | null;
    activeTab: string;
    /** Per-user card density, applied consistently on every surface. */
    cardDensity: CardDensity;
}

const TaskContext = createContext<TaskContextValue | null>(null);

interface TaskProviderProps {
    children: React.ReactNode;
    assignableUsers: User[];
    orgLabels: TaskLabel[];
    availableSprints: Sprint[];
    availableProjects: Project[];
    currentUser: User | null;
    activeTab: string;
    cardDensity?: CardDensity;
}

export function TaskProvider({
    children,
    assignableUsers,
    orgLabels,
    availableSprints,
    availableProjects,
    currentUser,
    activeTab,
    cardDensity = "comfortable",
}: TaskProviderProps) {
    const value = useMemo(
        () => ({
            assignableUsers,
            orgLabels,
            availableSprints,
            availableProjects,
            currentUser,
            activeTab,
            cardDensity,
        }),
        [
            assignableUsers,
            orgLabels,
            availableSprints,
            availableProjects,
            currentUser,
            activeTab,
            cardDensity,
        ],
    );
    return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export const useTaskCtx = () => useContext(TaskContext);

/** The card density for the current Tasks view, defaulting to comfortable. */
export function useCardDensity(): CardDensity {
    return useTaskCtx()?.cardDensity ?? "comfortable";
}