import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));

test("ticket lists document project scope and legacy scopes", () => {
    for (const route of [
        "/api/tasks",
        "/api/tasks/backlog",
        "/api/tasks/scheduled",
        "/api/tasks/search",
        "/api/tasks/lookup/quicksearch",
    ]) {
        const parameters = api.paths[route].get.parameters;
        assert.ok(parameters.some((parameter) => parameter.name === "project_id"), `${route} needs project_id`);
    }

    for (const route of ["/api/tasks", "/api/tasks/backlog", "/api/tasks/scheduled"]) {
        const parameters = api.paths[route].get.parameters;
        assert.ok(parameters.some((parameter) => parameter.name === "team_id"), `${route} needs legacy team_id`);
        assert.ok(parameters.some((parameter) => parameter.name === "unassigned"), `${route} needs legacy unassigned`);
    }
});
