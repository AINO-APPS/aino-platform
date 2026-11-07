/** Estimate rollout extends worklog contracts without owning author/warning policy. */
export function applyEstimateContract(paths,schemas) {
    const ref=name=>({$ref:`#/components/schemas/${name}`});
    const duration={type:'string',description:'Duration using w/d/h/m and org working hours. Empty text clears; 0m means zero.'};
    const remaining={remaining_mode:{type:'string',enum:['auto','set','leave'],default:'auto',description:'Auto applies the effort delta, clamps at zero and preserves null; set replaces the forecast; leave preserves it.'},remaining_estimate:duration};
    const fields={original_estimate_minutes:{type:['integer','null'],minimum:0},remaining_estimate_minutes:{type:['integer','null'],minimum:0}};
    Object.assign(schemas.Task.properties,fields);
    schemas.Task.properties.estimated_minutes.description='Legacy alias of original_estimate_minutes.';
    Object.assign(schemas.WorklogTicketSummary.properties,fields);
    schemas.WorklogTicketSummary.required.push(...Object.keys(fields));
    Object.assign(schemas.TaskWorklogList.properties,fields);
    schemas.TaskWorklogList.required.push(...Object.keys(fields));
    const can=schemas.TicketCapabilities.properties.can;
    can.properties.canEditEstimate=ref('TicketCapability');can.required=[...new Set([...can.required,'canEditEstimate'])];
    for(const name of ['LogWorkRequest','EditWorklogRequest','DeleteWorklogRequest']) {
        Object.assign(schemas[name].properties,remaining);
        schemas[name].allOf=[{if:{properties:{remaining_mode:{const:'set'}},required:['remaining_mode']},then:{required:['remaining_estimate']},else:{not:{required:['remaining_estimate']}}}];
    }
    schemas.SetEstimatesRequest={type:'object',additionalProperties:false,minProperties:1,properties:{original_estimate:duration,remaining_estimate:duration}};
    schemas.SetEstimatesResponse={type:'object',additionalProperties:false,required:['ticket'],properties:{ticket:ref('WorklogTicketSummary')}};
    const operation=paths['/api/tasks/{id}/estimates'].patch;
    operation.summary='Set or clear original and remaining estimates';
    operation.description='Requires canEditEstimate (same rule as logWork). Setting original seeds an empty remaining only when remaining is omitted. History/audit and estimates commit atomically; task_updated emits after commit.';
    operation.requestBody={required:true,content:{'application/json':{schema:ref('SetEstimatesRequest')}}};
    operation.responses['200']={description:'Estimates saved',content:{'application/json':{schema:ref('SetEstimatesResponse')}}};
    operation.responses['400'].description='INVALID_ESTIMATE: invalid duration, fields or ticket identifier; nothing changes.';
    operation.responses['403'].description='ACCESS_DENIED or WORKLOG_CANCELLED.';
    operation.responses['404']={description:'Ticket not found in this organization.'};
    for(const [path,method] of [['/api/tasks/{id}/worklogs','post'],['/api/tasks/{id}/worklogs/{worklogId}','patch'],['/api/tasks/{id}/worklogs/{worklogId}','delete']]) {
        paths[path][method].description += ' Remaining mode auto/set/leave applies in the same transaction; set requires remaining_estimate (empty clears).';
        paths[path][method].responses['400'].description += ' INVALID_ESTIMATE for invalid remaining choices.';
    }
}
