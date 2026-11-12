import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = JSON.parse(fs.readFileSync(path.join(root, 'contracts/openapi.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'contracts/http-route-inventory.json'), 'utf8'));

test('optional author on create and edit requires the behalf capability and documents separate attribution', () => {
    for (const name of ['LogWorkRequest', 'EditWorklogRequest']) {
        const author = api.components.schemas[name].properties.author_id;
        assert.equal(author?.type, 'integer');
        assert.equal(author.minimum, 1);
        assert.ok(!api.components.schemas[name].required.includes('author_id'));
        assert.match(author.description, /same organization/);
    }
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes('logWorkForOthers'));
    assert.ok(api.components.schemas.TicketCapability.properties.reason.enum.includes('WORKLOG_FOR_OTHERS_DENIED'));
    for (const [endpoint, method] of [['/api/tasks/{id}/worklogs', 'post'], ['/api/tasks/{id}/worklogs/{worklogId}', 'patch']])
        assert.match(api.paths[endpoint][method].responses['403'].description, /WORKLOG_FOR_OTHERS_DENIED/);
    assert.match(api.components.schemas.TaskWorklog.properties.canEdit.description, /org admin/);
    assert.match(api.components.schemas.TaskWorklog.properties.canEdit.description, /project.*admin/);
    assert.match(api.components.schemas.TaskWorklog.properties.canDelete.description, /project.*admin/);
    assert.match(api.components.schemas.TaskWorklog.properties.logged_by_id.description, /original/);
});

test('manual log-work route has duration input, saved worklog, summary, warnings and denial contracts', () => {
    assert.ok(inventory.endpoints.some(e => e.method === 'POST' && e.path === '/api/tasks/:id/worklogs'));
    const operation = api.paths['/api/tasks/{id}/worklogs'].post;
    assert.deepEqual(operation.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/LogWorkRequest' });
    assert.deepEqual(operation.responses['201'].content['application/json'].schema, { $ref: '#/components/schemas/LogWorkResponse' });
    assert.deepEqual(api.components.schemas.LogWorkRequest.required, ['day_worked', 'time_spent']);
    assert.ok(operation.responses['400'].description.includes('INVALID_DURATION'));
    assert.ok(operation.responses['403'].description.includes('WORKLOG_CANCELLED'));
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes('logWork'));
    assert.ok(api.components.schemas.TicketCapability.properties.reason.enum.includes('WORKLOG_CANCELLED'));
    assert.deepEqual(api.components.schemas.LogWorkResponse.properties.warnings.items.enum, ['ON_LEAVE', 'EXCEEDS_ATTENDANCE']);
    assert.match(api.components.schemas.LogWorkResponse.properties.warnings.description, /after commit/i);
});

test('worklog edit/delete contracts expose author capabilities, partial patch and soft-delete summary', () => {
    const endpoint = '/api/tasks/{id}/worklogs/{worklogId}';
    for (const method of ['patch', 'delete']) {
        assert.ok(inventory.endpoints.some(e => e.method === method.toUpperCase() && e.path === '/api/tasks/:id/worklogs/:worklogId'));
        assert.ok(api.paths[endpoint][method].responses['403']);
        assert.ok(api.paths[endpoint][method].responses['404']);
    }
    assert.deepEqual(api.paths[endpoint].patch.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/EditWorklogRequest' });
    const patch = api.components.schemas.EditWorklogRequest;
    assert.equal(patch.minProperties, 1);
    assert.equal(patch.additionalProperties, false);
    assert.ok(!patch.required?.length);
    assert.deepEqual(Object.keys(patch.properties).sort(), ['author_id', 'comment', 'day_worked', 'remaining_estimate', 'remaining_mode', 'start_time', 'time_spent']);
    assert.deepEqual(api.paths[endpoint].delete.responses['200'].content['application/json'].schema, { $ref: '#/components/schemas/DeleteWorklogResponse' });
    assert.deepEqual(api.components.schemas.DeleteWorklogResponse.required, ['ticket']);
    for (const capability of ['canEdit', 'canDelete']) {
        assert.ok(api.components.schemas.TaskWorklog.required.includes(capability));
        assert.equal(api.components.schemas.TaskWorklog.properties[capability].type, 'boolean');
    }
});

test('read-only worklog route documents its author, worked day and computed time', () => {
    assert.ok(inventory.endpoints.some(e => e.method === 'GET' && e.path === '/api/tasks/:id/worklogs'));
    const operation = api.paths['/api/tasks/{id}/worklogs'].get;
    assert.deepEqual(operation.responses['200'].content['application/json'].schema, { $ref: '#/components/schemas/TaskWorklogList' });
    assert.deepEqual(api.components.schemas.TaskWorklogList.required, ['worklogs', 'time_spent_minutes', 'original_estimate_minutes', 'remaining_estimate_minutes']);
    for (const key of ['original_estimate_minutes', 'remaining_estimate_minutes']) {
        assert.deepEqual(api.components.schemas.TaskWorklogList.properties[key].type, ['integer', 'null']);
        assert.equal(api.components.schemas.TaskWorklogList.properties[key].minimum, 0);
    }
    const worklog = api.components.schemas.TaskWorklog;
    for (const key of ['id', 'task_id', 'author_id', 'logged_by_id', 'author', 'logged_by', 'day_worked', 'minutes', 'comment', 'start_time', 'created_at', 'updated_at', 'deleted_at']) {
        assert.ok(worklog.required.includes(key), key);
    }
    assert.equal(worklog.properties.day_worked.format, 'date');
    assert.equal(worklog.properties.minutes.minimum, 1);
    assert.equal(api.components.schemas.Task.properties.time_spent_minutes.minimum, 0);
    for (const [url, method] of [['/api/tasks/{id}/timer', 'get'], ['/api/tasks/{id}/timer/start', 'post'], ['/api/tasks/{id}/timer/stop', 'post']]) {
        assert.equal(api.paths[url]?.[method], undefined);
        assert.equal(inventory.endpoints.find(e => e.path === url.replace('{id}', ':id') && e.method === method.toUpperCase()).retiredBy, 'ticket-11');
    }
    assert.equal(api.components.schemas.TaskTimerStopResponse, undefined);
    assert.equal(api.components.schemas.Task.properties.logged_minutes, undefined);
    assert.equal(api.components.schemas.Task.properties.estimated_minutes, undefined);
});
