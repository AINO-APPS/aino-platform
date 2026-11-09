import { useTeamScope } from "./useTeamScope";
import { useProjectScope } from "./useProjectScope";
import { useEffect } from "react";
import { useAgileConfig } from "../../../AgileConfigContext";

const EMPTY: any[] = [];

/** Keep the legacy team surface isolated from the project ownership switch. */
export function usePlanningScope(options: {
    currentUser: any;
    projects: any[];
    projectsLoaded: boolean;
    availableSprints: any[];
    setSelectedSprintId: (id: any) => void;
    agileEnabled: boolean;
}) {
    const { currentUser, projects, projectsLoaded, availableSprints, setSelectedSprintId, agileEnabled } = options;
    const enabled = currentUser?.project_ownership === true;
    const legacy = useTeamScope({ currentUser, availableSprints, setSelectedSprintId, agileEnabled, enabled: !enabled });
    const project = useProjectScope({
        projects, projectsLoaded, enabled, agileEnabled,
        userKey: `${currentUser?.tenant_id}:${currentUser?.id}`, setSelectedSprintId,
    });
    const { setProjectScope } = useAgileConfig();
    useEffect(() => {
        if (enabled) setProjectScope?.(project.selectedProjectId);
        return () => { if (enabled) setProjectScope?.(null); };
    }, [enabled, project.selectedProjectId, setProjectScope]);
    const scope = enabled ? {
        showTeamSwitcher: false,
        orgTeams: EMPTY,
        selectedTeamId: project.selectedProjectId,
        setSelectedTeamId: (id: any) => project.changeProject(Number(id)),
        effectiveTeamId: null,
        visibleSprints: project.visibleSprints,
        teamScopeParams: project.scopeParams,
        currentSprintId: project.currentSprintId,
        currentSprintLoaded: project.currentSprintLoaded,
    } : legacy;
    return { ...scope, selectedProject: project.selectedProject, selectedProjectId: project.selectedProjectId, changeProject: project.changeProject };
}
