import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
const parity = JSON.parse(fs.readFileSync(new URL("../tasks-parity.json", import.meta.url), "utf8"));

test("org settings document a nullable active Service Desk project", () => {
    const operation = api.paths["/api/org/settings"].put;
    assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/OrgSettingsUpdate");
    assert.deepEqual(api.components.schemas.OrgSettingsUpdate.properties.service_desk_project_id.type, ["integer", "null"]);
    assert.match(operation.description, /active project.*organization/);
    assert.ok(operation.responses["400"]);
    assert.ok(api.paths["/api/org/current"].get.responses["200"]);
});

test("Service Desk contract preserves submission and describes sync and cancel semantics", () => {
    assert.ok(api.paths["/api/service-desk/tickets"].post.responses["201"]);
    assert.match(api.paths["/api/service-desk/tickets"].post.description, /General/);
    assert.match(api.paths["/api/service-desk/tickets"].post.description, /fails/);
    assert.match(api.paths["/api/service-desk/tickets/{id}"].patch.description, /cancelled.*never/i);
    assert.match(api.paths["/api/service-desk/tickets/{id}"].delete.description, /Done.*stays Done/);
    const history = api.components.schemas.TaskHistoryEntry;
    assert.deepEqual(history.properties.user_id.type, ["integer", "null"]);
    assert.deepEqual(history.properties.actor_type.enum, ["user", "system"]);
});

test("parity records Service Desk projects as shipped on web with native settings waived", () => {
    const feature = parity.features.find(feature => feature.id === "service-desk-project");
    assert.equal(feature.web.status, "shipped");
    assert.equal(feature.desktop.status, "shipped");
    assert.equal(feature.android.status, "waived");
    assert.equal(parity.non_goals.some(feature => feature.id === "service-desk-changes"), false);
});
