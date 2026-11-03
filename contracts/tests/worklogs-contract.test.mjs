import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = JSON.parse(fs.readFileSync(path.join(root, 'contracts/openapi.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'contracts/http-route-inventory.json'), 'utf8'));

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
    assert.deepEqual(Object.keys(patch.properties).sort(), ['comment', 'day_worked', 'start_time', 'time_spent']);
    assert.deepEqual(api.paths[endpoint].delete.responses['200'].content['application/json'].schema, { $ref: '#/components/schemas/DeleteWorklogResponse' });
    assert.deepEqual(api.components.schemas.DeleteWorklogResponse.required, ['ticket']);
    for (const capability of ['canEdit', 'canDelete']) {
        assert.ok(api.components.schemas.TaskWorklog.required.includes(capability));
        assert.equal(api.components.schemas.TaskWorklog.properties[capability].type, 'boolean');
    }
    const waiver = JSON.parse(fs.readFileSync(path.join(root, 'contracts/android-worklogs-waiver.json'), 'utf8'));
    for (const method of ['PATCH', 'DELETE']) assert.ok(waiver.waivers.some(w => w.key === `${method} /api/tasks/:param/worklogs/:param`));
});

test('read-only worklog route documents its author, worked day and computed time', () => {
    assert.ok(inventory.endpoints.some(e => e.method === 'GET' && e.path === '/api/tasks/:id/worklogs'));
    const operation = api.paths['/api/tasks/{id}/worklogs'].get;
    assert.deepEqual(operation.responses['200'].content['application/json'].schema, { $ref: '#/components/schemas/TaskWorklogList' });
    assert.deepEqual(api.components.schemas.TaskWorklogList.required, ['worklogs', 'time_spent_minutes']);
    const worklog = api.components.schemas.TaskWorklog;
    for (const key of ['id', 'task_id', 'author_id', 'logged_by_id', 'author', 'logged_by', 'day_worked', 'minutes', 'comment', 'start_time', 'created_at', 'updated_at', 'deleted_at']) {
        assert.ok(worklog.required.includes(key), key);
    }
    assert.equal(worklog.properties.day_worked.format, 'date');
    assert.equal(worklog.properties.minutes.minimum, 1);
    assert.equal(api.components.schemas.Task.properties.time_spent_minutes.minimum, 0);
    for (const [url, method] of [['/api/tasks/{id}/timer', 'get'], ['/api/tasks/{id}/timer/start', 'post'], ['/api/tasks/{id}/timer/stop', 'post']]) {
        assert.equal(api.paths[url][method].deprecated, true);
        assert.equal(inventory.endpoints.find(e => e.path === url.replace('{id}', ':id') && e.method === method.toUpperCase()).deprecated, true);
    }
    assert.equal(api.components.schemas.TaskTimerStopResponse.properties.minutes.minimum, 1);
});
