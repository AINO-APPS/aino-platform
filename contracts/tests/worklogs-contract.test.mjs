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
    assert.deepEqual(api.components.schemas.LogWorkResponse.properties.warnings.items.enum, ['ON_LEAVE', 'EXCEEDS_ATTENDANCE']);
    assert.match(api.components.schemas.LogWorkResponse.properties.warnings.description, /after commit/i);
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
