import { useProjectScope } from "./useProjectScope";
import { useEffect } from "react";
import { useAgileConfig } from "../../../AgileConfigContext";

const EMPTY: any[] = [];

/** Released planning never falls back to retired team-scope requests. */
export function usePlanningScope(options: {
    currentUser: any;
    projects: any[];
    projectsLoaded: boolean;
    availableSprints: any[];
    setSelectedSprintId: (id: any) => void;
    agileEnabled: boolean;
}) {
    const { currentUser, projects, projectsLoaded, setSelectedSprintId, agileEnabled } = options;
    const enabled = currentUser?.project_ownership === true;
    const project = useProjectScope({
        projects, projectsLoaded, enabled, agileEnabled,
        userKey: `${currentUser?.tenant_id}:${currentUser?.id}`, setSelectedSprintId,
    });
    const { setProjectScope } = useAgileConfig();
    useEffect(() => {
        if (enabled) setProjectScope?.(project.selectedProjectId);
        return () => { if (enabled) setProjectScope?.(null); };
    }, [enabled, project.selectedProjectId, setProjectScope]);
    const scope = {
        showTeamSwitcher: false,
        orgTeams: EMPTY,
        selectedTeamId: project.selectedProjectId,
        setSelectedTeamId: (id: any) => project.changeProject(Number(id)),
        effectiveTeamId: null,
        visibleSprints: project.visibleSprints,
        teamScopeParams: project.scopeParams,
        currentSprintId: project.currentSprintId,
        currentSprintLoaded: project.currentSprintLoaded,
    };
    return { ...scope, selectedProject: project.selectedProject, selectedProjectId: project.selectedProjectId, changeProject: project.changeProject };
}
