import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateJsonSchema } from "../../scripts/lib/json-schema-lite.mjs";

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const api = read("openapi.json");
test("the my-projects picker is a capability-filtered array of active projects", () => {
    const operation = api.paths["/api/projects/mine"].get;
    assert.match(operation.description, /canCreateTickets/);
    assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/MyProjectList");
    const list = api.components.schemas.MyProjectList;
    assert.equal(list.type, "array");
    assert.equal(list.items.$ref, "#/components/schemas/Project");
});
test("both create routes accept legacy omission, describe project resolution, and document stable refusals", () => {
    for (const path of ["/api/tasks", "/api/tasks/backlog"]) {
        const operation = api.paths[path].post;
        assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/CreateTicketRequest");
        assert.match(operation.description, /request.*sprint.*team.*General/);
        assert.match(JSON.stringify(operation.responses["409"]), /SPRINT_PROJECT_MISMATCH/);
        assert.match(JSON.stringify(operation.responses["409"]), /PROJECT_ARCHIVED/);
        assert.match(JSON.stringify(operation.responses["403"]), /READ_ONLY_ROLE/);
    }
    const input = api.components.schemas.CreateTicketRequest;
    assert.deepEqual(validateJsonSchema(input, { title: "Legacy ticket" }), []);
    assert.deepEqual(validateJsonSchema(input, { title: "New ticket", project_id: 20 }), []);
    assert.ok(validateJsonSchema(input, { title: "Bad ticket", project_id: "20garbage" }).length);
});
test("only project mismatch is in the capability catalogue and create-picker parity is explicit", () => {
    for (const name of ["TicketCapability", "TicketTransitionCapability"]) {
        const reasons = api.components.schemas[name].properties.reason.enum;
        assert.ok(reasons.includes("SPRINT_PROJECT_MISMATCH"));
        assert.ok(!reasons.includes("SPRINT_TEAM_MISMATCH"));
    }
    const feature = read("tasks-parity.json").features.find(item => item.id === "ticket-create-project");
    assert.equal(feature.web.status, "shipped");
    assert.equal(feature.desktop.status, "shipped");
    assert.equal(feature.android.status, "shipped");
    assert.match(feature.android.owner_test, /ProjectOwnershipViewModelTest\.kt$/);
    assert.equal(feature.android.waiver, undefined);
});
