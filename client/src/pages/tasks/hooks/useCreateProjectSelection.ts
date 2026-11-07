import { useEffect, useMemo, useRef } from "react";

export function useCreateProjectSelection({
    enabled, projects, currentProjectId, userKey, value, onChange,
}: {
    enabled: boolean; projects: any[]; currentProjectId?: unknown; userKey: string;
    value: string; onChange: (value: string) => void;
}) {
    const creatable = useMemo(() => projects.filter(project =>
        !project.is_archived && project.capabilities?.canCreateTickets === true), [projects]);
    const storageKey = `tasks.lastCreateProjectId.${userKey}`;
    const previousScope = useRef("");
    useEffect(() => {
        if (!enabled) return;
        const known = (id: unknown) => creatable.some(project => String(project.id) === String(id));
        const scope = `${storageKey}.${currentProjectId}`;
        const scopeChanged = previousScope.current !== scope;
        previousScope.current = scope;
        if (!scopeChanged && known(value)) return;
        let last = "";
        try { last = localStorage.getItem(storageKey) || ""; } catch { /* storage unavailable */ }
        onChange(known(currentProjectId) ? String(currentProjectId) : known(last) ? last : "");
    }, [enabled, creatable, currentProjectId, storageKey, value, onChange]);
    return {
        projects: creatable,
        remember: (projectId = value) => {
            if (!enabled || !creatable.some(project => String(project.id) === projectId)) return;
            try { localStorage.setItem(storageKey, projectId); } catch { /* storage unavailable */ }
        },
    };
}
