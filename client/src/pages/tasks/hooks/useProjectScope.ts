import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSprints } from "../../../api/tasks";

const EMPTY: any[] = [];

export function useProjectScope({
    projects, projectsLoaded = true, enabled, agileEnabled, userKey, setSelectedSprintId,
}: {
    projects: any[];
    projectsLoaded?: boolean;
    enabled: boolean;
    agileEnabled: boolean;
    userKey: string;
    setSelectedSprintId: (id: any) => void;
}) {
    const storageKey = `tasks.selectedProjectId.${userKey}`;
    const [selectedProjectId, setProjectId] = useState<number | null>(null);
    useEffect(() => {
        if (!enabled) return;
        const known = (id: number | null) => projects.some((project) => project.id === id);
        setProjectId((current) => {
            if (known(current)) return current;
            let stored: number | null = null;
            try { stored = Number(localStorage.getItem(storageKey)); } catch { /* storage unavailable */ }
            return known(stored) ? stored : projects[0]?.id ?? null;
        });
    }, [projects, enabled, storageKey]);
    const selectedProject = projects.find((project) => project.id === selectedProjectId);
    const hasSprints = selectedProject?.hasSprints ?? agileEnabled;
    const scopeParams = useMemo(() => ({ project_id: selectedProjectId ?? -1 }), [selectedProjectId]);
    const { data, isFetched } = useQuery({
        queryKey: ["tasks", "sprintList", scopeParams],
        enabled: enabled && hasSprints && selectedProjectId != null,
        queryFn: async () => (await getSprints(scopeParams)).data as any,
    });
    const visibleSprints = enabled && hasSprints && selectedProjectId != null
        ? (data?.sprints ?? EMPTY).filter((sprint: any) => Number(sprint.project_id) === selectedProjectId)
        : EMPTY;
    const currentSprintId = hasSprints ? data?.currentSprintId ?? null : null;
    const currentSprintLoaded = !enabled || !hasSprints
        || (projectsLoaded && projects.length === 0)
        || (selectedProjectId != null && isFetched);
    useEffect(() => {
        if (!enabled || !currentSprintLoaded) return;
        setSelectedSprintId((previous: any) => visibleSprints.some((sprint: any) => sprint.id === previous)
            ? previous : currentSprintId ?? (selectedProject?.hasSprints === undefined ? visibleSprints[0]?.id : null) ?? null);
    }, [enabled, data, selectedProjectId, currentSprintId, currentSprintLoaded, setSelectedSprintId]);
    const changeProject = useCallback((id: number) => {
        if (!projects.some((project) => project.id === id)) return;
        setSelectedSprintId(null);
        setProjectId(id);
        try { localStorage.setItem(storageKey, String(id)); } catch { /* storage unavailable */ }
    }, [projects, storageKey, setSelectedSprintId]);
    return { selectedProject, selectedProjectId, changeProject, scopeParams, visibleSprints, currentSprintId, currentSprintLoaded };
}
