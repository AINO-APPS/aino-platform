import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const generator = path.join(root, "scripts", "generate-api-models.mjs");
const openapi = JSON.parse(fs.readFileSync(path.join(root, "contracts", "openapi.json"), "utf8"));

const WEB_OUTPUT = path.join(root, "client", "src", "types", "generated", "tasks.ts");

test("the contract defines the canonical task and sprint models", () => {
    for (const name of ["Task", "Sprint", "SprintBaseline", "TaskListResponse", "BacklogResponse"]) {
        assert.ok(openapi.components?.schemas?.[name], `contract is missing the ${name} schema`);
    }
});

test("the task model carries the fields the Tasks spec depends on", () => {
    const task = openapi.components.schemas.Task;
    for (const field of [
        "issue_key",
        "workflow_state_id",
        "planned_date",
        "due_date",
        "completed_at",
        "sprint_id",
        "team_id",
        "rank",
    ]) {
        assert.ok(field in task.properties, `Task is missing ${field}`);
    }
    assert.ok(task.required.includes("completed_at"), "completed_at must be required so clients cannot omit it");
});

test("generated web models are current", () => {
    execFileSync(process.execPath, [generator, "--check"], { cwd: root, stdio: "pipe" });
});

test("generated web models are committed and reproduce deterministically", () => {
    assert.ok(fs.existsSync(WEB_OUTPUT), "generated web models are missing");
    const first = fs.readFileSync(WEB_OUTPUT, "utf8");
    execFileSync(process.execPath, [generator], { cwd: root, stdio: "pipe" });
    const second = fs.readFileSync(WEB_OUTPUT, "utf8");
    assert.equal(second, first, "regenerating produced different output");
});

test("removing a contract field changes the generated output", () => {
    const original = fs.readFileSync(WEB_OUTPUT, "utf8");
    const mutated = JSON.parse(JSON.stringify(openapi));
    delete mutated.components.schemas.Task.properties.rank;

    const sourcePath = path.join(root, "contracts", "openapi.json");
    const backup = fs.readFileSync(sourcePath, "utf8");
    try {
        fs.writeFileSync(sourcePath, `${JSON.stringify(mutated, null, 2)}\n`);
        execFileSync(process.execPath, [generator], { cwd: root, stdio: "pipe" });
        const afterRemoval = fs.readFileSync(WEB_OUTPUT, "utf8");
        assert.notEqual(afterRemoval, original, "removing a contract field must change the generated models");
        assert.ok(!afterRemoval.includes("rank:"), "the removed field is still present");
    } finally {
        fs.writeFileSync(sourcePath, backup);
        execFileSync(process.execPath, [generator], { cwd: root, stdio: "pipe" });
    }
    assert.equal(fs.readFileSync(WEB_OUTPUT, "utf8"), original, "the generator did not restore the original output");
});
