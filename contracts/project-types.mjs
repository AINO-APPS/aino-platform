export function applyProjectTypeContract(paths, schemas) {
    const ref = name => ({ $ref: `#/components/schemas/${name}` });
    const array = name => ({ type: 'array', items: ref(name) });
    schemas.ProjectType = { type: 'string', enum: ['scrum', 'kanban', 'task_list'] };
    schemas.PlanTab = { type: 'string', enum: ['backlog', 'sprint', 'reports', 'board', 'list', 'calendar'] };
    schemas.ProjectTypeOptions = { type: 'object', properties: { availableTypes: array('ProjectType'), defaultType: ref('ProjectType') }, required: ['availableTypes', 'defaultType'], additionalProperties: false };
    schemas.ProjectCapabilities.properties.canChangeType = { type: 'boolean', description: 'Project admin of a non-archived project. Allowed destinations are in changeableTypes.' };
    schemas.ProjectCapabilities.required.push('canChangeType');
    Object.assign(schemas.Project.properties, {
        kanban_backlog_enabled: { type: 'boolean', default: false }, planTabs: array('PlanTab'),
        hasSprints: { type: 'boolean' }, hasBacklog: { type: 'boolean' },
        boardScope: { type: 'string', enum: ['current_sprint', 'open_tickets', 'open_except_initial'] },
        doneWindowDays: { type: 'integer', const: 14 }, includeCancelled: { type: 'boolean', const: false },
        availableTypes: array('ProjectType'), changeableTypes: array('ProjectType'),
    });
    schemas.Project.properties.type = ref("ProjectType");
    schemas.Project.required.push('type', 'planTabs', 'availableTypes', 'changeableTypes', 'hasSprints', 'hasBacklog');
    schemas.CreateProjectRequest.properties.type = { ...ref('ProjectType'), description: 'Defaults to Scrum with agile enabled, otherwise Task list.' };
    schemas.UpdateProjectRequest = { type: 'object', properties: {
        name: { type: 'string' }, description: { type: ['string', 'null'] }, color: { type: 'string' },
        lead_user_id: { type: ['integer', 'null'] }, type: ref('ProjectType'),
    }, additionalProperties: false };
    paths['/api/projects/types'].get = { ...paths['/api/projects/types'].get,
        operationId: 'getProjectTypes', summary: 'Organization project type choices',
        description: 'agile controls creation and type-change destinations only. Existing projects retain their type and capabilities.',
        responses: { '200': { description: 'Type options', content: { 'application/json': { schema: ref('ProjectTypeOptions') } } } },
    };
    const update = paths['/api/projects/{id}'].put;
    update.requestBody = { required: true, content: { 'application/json': { schema: ref('UpdateProjectRequest') } } };
    update.description = 'Project admin only. Settings and type change commit atomically. Leaving Scrum refuses planned, active or paused sprints with PROJECT_HAS_OPEN_SPRINTS (409). Non-agile destinations refuse PROJECT_TYPE_NOT_AVAILABLE (403). Unchanged types remain editable after feature loss; archived projects cannot change type.';
    update.responses['409'] = { description: 'PROJECT_HAS_OPEN_SPRINTS or PROJECT_ARCHIVED' };
    update.responses['403'] = { description: 'ACCESS_DENIED or PROJECT_TYPE_NOT_AVAILABLE' };
    for (const name of ['TicketCapability', 'TicketTransitionCapability']) schemas[name].properties.reason.enum.push('PROJECT_HAS_NO_SPRINTS');
}
