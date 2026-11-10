import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'contracts', 'http-route-inventory.json'), 'utf8'));
const estimate = 'PATCH /api/tasks/:param/estimates';
const key = endpoint => `${endpoint.method} ${endpoint.path.replace(/:[^/]+/g, ':param')}`;

function withAndroid(covered, waivers, verify) {
    const checkout = path.join(root, 'contracts', 'tests', `.android-worklogs-${process.pid}`);
    fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'contracts'), { recursive: true });
    fs.mkdirSync(path.join(checkout, 'docs'), { recursive: true });
    const write = (file, value) => fs.writeFileSync(path.join(checkout, file), JSON.stringify(value));
    // The external native checker owns its snapshot; this test exercises the platform's current-inventory gate.
    fs.writeFileSync(path.join(checkout, 'scripts', 'check-endpoint-parity.mjs'), 'console.log("native snapshot valid");');
    write('contracts/http-route-inventory.json', inventory);
    write('contracts/android-endpoint-coverage.json', { covered, unmatched: [] });
    write('docs/parity-waivers.json', { waivers });
    try {
        let result;
        try {
            result = { code: 0, stdout: execFileSync(process.execPath, [path.join(root, 'scripts', 'check-android-endpoint-parity.mjs'), checkout], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), stderr: '' };
        } catch (error) {
            result = { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
        }
        verify(result);
    } finally {
        fs.rmSync(checkout, { recursive: true, force: true });
    }
}

test('manual-worklog coverage passes without resolving unrelated existing parity debt', () => {
    const manual = inventory.endpoints.filter(endpoint => /\/(worklogs(?:\/:\w+)?|estimates)$/.test(endpoint.path));
    withAndroid(manual, [], result => {
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /5 proven/);
        assert.ok(result.stdout.includes(`${inventory.endpoints.length - manual.length} existing pending`));
    });
});

test('shipped manual-worklog coverage cannot retain a temporary native waiver', () => {
    withAndroid(inventory.endpoints, [{ key: estimate, owner: 'manual-worklogs ticket 08', reason: 'Temporary rollout' }], result => {
        assert.equal(result.code, 1);
        assert.match(result.stderr, /Remove shipped manual-worklog Android waivers/);
        assert.match(result.stderr, /PATCH \/api\/tasks\/:param\/estimates/);
    });
});

test('native worklog list and mutations need coverage even when already in the snapshot', () => {
    const worklogs = ['GET /api/tasks/:param/worklogs', 'POST /api/tasks/:param/worklogs', 'PATCH /api/tasks/:param/worklogs/:param', 'DELETE /api/tasks/:param/worklogs/:param'];
    withAndroid(inventory.endpoints.filter(endpoint => key(endpoint) === estimate), worklogs.map(key => ({ key })), result => {
        assert.equal(result.code, 1);
        assert.match(result.stderr, /Manual worklog routes require Android coverage/);
        for (const operation of worklogs) assert.ok(result.stderr.includes(operation), operation);
    });
});

test('native estimates need real coverage even when an old snapshot and waiver claim the route', () => {
    withAndroid([], [{ key: estimate }], result => {
        assert.equal(result.code, 1);
        assert.match(result.stderr, /Manual worklog routes require Android coverage/);
        assert.match(result.stderr, /PATCH \/api\/tasks\/:param\/estimates/);
    });
});
