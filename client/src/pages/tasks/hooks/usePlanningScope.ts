import { useTeamScope } from "./useTeamScope";
import { useProjectScope } from "./useProjectScope";

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
    return { ...scope, selectedProjectId: project.selectedProjectId, changeProject: project.changeProject };
}
