import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const api=JSON.parse(fs.readFileSync(new URL('../openapi.json',import.meta.url),'utf8'));
test('estimates and remaining worklog choices have published API contracts',()=>{
    const route=api.paths['/api/tasks/{id}/estimates']?.patch;
    assert.ok(route);
    assert.equal(route.requestBody.content['application/json'].schema.$ref,'#/components/schemas/SetEstimatesRequest');
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes('canEditEstimate'));
    for(const schema of ['Task','WorklogTicketSummary'])for(const field of ['original_estimate_minutes','remaining_estimate_minutes'])
        assert.equal(api.components.schemas[schema].properties[field].minimum,0);
    for(const schema of ['LogWorkRequest','EditWorklogRequest','DeleteWorklogRequest'])
        assert.deepEqual(api.components.schemas[schema].properties.remaining_mode.enum,['auto','set','leave']);
});
