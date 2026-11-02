import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));

test("scheduling a ticket in a sprint documents the IN_SPRINT conflict", () => {
    const response = api.paths["/api/tasks/{id}/schedule"].patch.responses["409"];

    assert.ok(response, "schedule endpoint must document HTTP 409");
    assert.equal(response.description, "Ticket is in a sprint and cannot be scheduled to a day");
    assert.deepEqual(response.content["application/json"].schema, {
        $ref: "#/components/schemas/Error",
    });
    assert.equal(
        response.content["application/json"].examples.inSprint.value.error,
        "This ticket is in a sprint. Take it out of the sprint before planning it onto a day.",
    );
    assert.equal(
        response.content["application/json"].examples.inSprint.value.code,
        "IN_SPRINT",
    );
});
