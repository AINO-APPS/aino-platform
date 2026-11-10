import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'contracts/http-route-inventory.json'), 'utf8'));
const operations = [
    ['GET', '/api/projects'],
    ['GET', '/api/projects/mine'],
    ['GET', '/api/sprints'],
    ['GET', '/api/tasks/backlog'],
    ['POST', '/api/tasks/backlog'],
    ['GET', '/api/tasks/by-key/:param'],
    ['POST', '/api/tasks/:param/move-project/preview'],
    ['POST', '/api/tasks/:param/move-project'],
];

function run(covered = operations, waivers = []) {
    const checkout = path.join(root, 'contracts/tests', `.android-projects-${process.pid}`);
    for (const dir of ['scripts', 'contracts', 'docs']) fs.mkdirSync(path.join(checkout, dir), { recursive: true });
    const write = (file, value) => fs.writeFileSync(path.join(checkout, file), JSON.stringify(value));
    fs.writeFileSync(path.join(checkout, 'scripts/check-endpoint-parity.mjs'), 'console.log("native snapshot valid");');
    write('contracts/http-route-inventory.json', inventory);
    write('contracts/android-endpoint-coverage.json', {
        covered: covered.map(([method, path]) => ({ method, path })), unmatched: [],
    });
    write('docs/parity-waivers.json', { waivers });
    try {
        try {
            return { code: 0, stdout: execFileSync(process.execPath, [
                path.join(root, 'scripts/check-android-endpoint-parity.mjs'), checkout, '--projects-only',
            ], { encoding: 'utf8', stdio: 'pipe' }) };
        } catch (error) {
            return { code: error.status, stderr: String(error.stderr) };
        }
    } finally {
        fs.rmSync(checkout, { recursive: true, force: true });
    }
}

test('project closeout proves native project operations independently of unrelated worklog rollout', () => {
    const result = run();
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /project scope only.*8 required operations proven/);
});

test('project alias lookup cannot be excused by an old snapshot or a waiver', () => {
    const result = run(operations.filter(([, path]) => !path.includes('by-key')), [{
        key: 'GET /api/tasks/by-key/:param', owner: 'ticket13', reason: 'Temporary rollout',
    }]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Project routes require Android coverage/);
    assert.match(result.stderr, /GET \/api\/tasks\/by-key\/:param/);
});

test('shipped project routes cannot retain rollout waivers', () => {
    const result = run(operations, [{
        key: 'POST /api/tasks/:param/move-project', owner: 'ticket13', reason: 'Temporary rollout',
    }]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Remove shipped project Android waivers/);
});
