import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateJsonSchema } from '../../scripts/lib/json-schema-lite.mjs';
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
