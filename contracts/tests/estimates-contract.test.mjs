import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=JSON.parse(fs.readFileSync(new URL('../openapi.json',import.meta.url),'utf8'));
test('estimates and remaining worklog choices are covered with a temporary Android waiver',()=>{
    const route=api.paths['/api/tasks/{id}/estimates']?.patch;
    assert.ok(route);
    assert.equal(route.requestBody.content['application/json'].schema.$ref,'#/components/schemas/SetEstimatesRequest');
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes('canEditEstimate'));
    for(const schema of ['Task','WorklogTicketSummary'])for(const field of ['original_estimate_minutes','remaining_estimate_minutes'])
        assert.equal(api.components.schemas[schema].properties[field].minimum,0);
    for(const schema of ['LogWorkRequest','EditWorklogRequest','DeleteWorklogRequest'])
        assert.deepEqual(api.components.schemas[schema].properties.remaining_mode.enum,['auto','set','leave']);
    const waiver=JSON.parse(fs.readFileSync(new URL('../android-worklogs-waiver.json',import.meta.url),'utf8'));
    assert.ok(waiver.waivers.some(row=>row.key==='PATCH /api/tasks/:param/estimates'));
});
