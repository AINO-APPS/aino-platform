#!/usr/bin/env node
/** Read-only native proof plus current-platform delta gate; never rewrites Android snapshots. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = process.argv[2];
if (!android) throw new Error('Provide the Android checkout path; it is inspected read-only.');
execFileSync(process.execPath, [path.join(android, 'scripts', 'check-endpoint-parity.mjs'), root], { stdio: 'inherit', cwd: root });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inventory = read(path.join(root, 'contracts', 'http-route-inventory.json'));
const prior = read(path.join(android, 'contracts', 'http-route-inventory.json'));
const coverage = read(path.join(android, 'contracts', 'android-endpoint-coverage.json'));
const nativeWaivers = read(path.join(android, 'docs', 'parity-waivers.json')).waivers;
const temporary = read(path.join(root, 'contracts', 'android-worklogs-waiver.json')).waivers;
const key = e => `${e.method} ${e.path.replace(/:[^/]+/g, ':param')}`;
const existing = new Set(prior.endpoints.map(key));
const proven = new Set(coverage.covered.map(key));
const waived = new Set(nativeWaivers.map(w => w.key));
for (const waiver of temporary) {
    if (!waiver.key || !waiver.owner || !waiver.reason || !waiver.removeWhen) throw new Error('Temporary Android waivers require key, owner, reason and removal condition.');
    if (!inventory.endpoints.some(e => key(e) === waiver.key)) throw new Error(`Stale platform waiver: ${waiver.key}`);
    if (proven.has(waiver.key)) throw new Error(`Remove shipped Android waiver: ${waiver.key}`);
    waived.add(waiver.key);
}
const uncovered = inventory.endpoints.filter(e => !existing.has(key(e)) && !proven.has(key(e)) && !waived.has(key(e)));
if (uncovered.length) throw new Error(`New platform routes lack Android coverage or a rollout waiver: ${uncovered.map(key).join(', ')}`);
const pending = inventory.endpoints.filter(e => !proven.has(key(e)) && !waived.has(key(e)));
console.log(`platform/android endpoint-parity: OK — ${inventory.endpoints.length} current operations, ${inventory.endpoints.filter(e => proven.has(key(e))).length} proven, ${inventory.endpoints.filter(e => waived.has(key(e))).length} waived, ${pending.length} existing pending, ${coverage.unmatched.length} existing unmatched.`);
