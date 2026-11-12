import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));

test("calendar overlays remain while scheduled-placement endpoints are retired", () => {
    for (const [path, method] of [
        ["/api/tasks/scheduled", "get"],
        ["/api/tasks/{id}/schedule", "patch"],
        ["/api/tasks/{id}/unschedule", "patch"],
    ]) {
        assert.equal(api.paths[path]?.[method], undefined, `${method} ${path} remains supported`);
    }
    assert.ok(api.paths["/api/tasks/schedule-overlays"]?.get);
});
