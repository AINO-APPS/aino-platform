import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateJsonSchema } from '../../scripts/lib/json-schema-lite.mjs';
import { projectTypesRetiredOperations } from '../project-types-removal.mjs';
const api = JSON.parse(fs.readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
const schemas = api.components.schemas;
test('project responses require server-decided tabs and type capabilities', () => {
    for (const field of ['type', 'planTabs', 'availableTypes', 'changeableTypes', 'hasSprints', 'hasBacklog']) assert.ok(schemas.Project.required.includes(field));
    assert.ok(schemas.ProjectCapabilities.required.includes('canChangeType'));
    assert.deepEqual(schemas.PlanTab.enum, ['backlog', 'sprint', 'reports', 'board', 'list', 'calendar']);
    assert.deepEqual(schemas.ProjectType.enum, ['scrum', 'kanban', 'task_list']);
    assert.ok(schemas.TicketCapability.properties.reason.enum.includes('PROJECT_HAS_NO_SPRINTS'));
});
test('organization choices and create/update types are explicit reproducible contracts', () => {
    assert.equal(api.paths['/api/projects/types'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/ProjectTypeOptions');
    for (const name of ['CreateProjectRequest', 'UpdateProjectRequest']) assert.equal(schemas[name].properties.type.$ref, '#/components/schemas/ProjectType');
    assert.deepEqual(validateJsonSchema(schemas.ProjectTypeOptions, { availableTypes: ['task_list'], defaultType: 'task_list' }, api), []);
    assert.match(api.paths['/api/projects/{id}'].put.description, /PROJECT_HAS_OPEN_SPRINTS/);
    assert.match(api.paths['/api/projects/{id}'].put.description, /PROJECT_TYPE_NOT_AVAILABLE/);
});
test('ticket 11 removes retired operations and legacy aliases', () => {
    const inventory = JSON.parse(fs.readFileSync(new URL('../http-route-inventory.json', import.meta.url), 'utf8'));
    for (const [method, path] of projectTypesRetiredOperations) {
        const openApiPath = path.replace(/:([^/]+)/g, '{$1}');
        assert.equal(api.paths[openApiPath]?.[method.toLowerCase()], undefined, `${method} ${path} remains supported`);
        assert.ok(inventory.endpoints.some(endpoint =>
            endpoint.method === method && endpoint.path === path && endpoint.deprecated && endpoint.retiredBy === 'ticket-11'));
    }
    for (const name of ['Task', 'SearchTask', 'Sprint', 'TaskByKey', 'WorklogTicketSummary']) {
        for (const field of ['planned_date', 'pre_sprint_due_date', 'issue_key', 'logged_minutes', 'estimated_minutes', 'team_id']) {
            assert.equal(schemas[name]?.properties?.[field], undefined, `${name}.${field} remains in the supported contract`);
        }
    }
    assert.deepEqual(schemas.Task.properties.container.enum, ['sprint', 'backlog', 'board']);
    assert.deepEqual(schemas.SearchTask.properties.container.enum, ['sprint', 'backlog', 'board']);
    for (const name of ['ProjectMigrationReview', 'ProjectOwnershipState']) assert.equal(schemas[name], undefined);
});
