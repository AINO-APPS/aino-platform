/** Manual-worklog rollout contract; legacy timer envelopes are unchanged. */
export function applyWorklogContract(paths, schemas) {
    const ref = name => ({ $ref: `#/components/schemas/${name}` });
    const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
    const user = object({ id: { type: 'integer' }, username: { type: 'string' }, full_name: { type: ['string', 'null'] }, avatar: { type: ['string', 'null'] } });
    schemas.TaskWorklog = object({
        id: { type: 'integer' }, task_id: { type: 'integer' }, author_id: { type: 'integer' },
        logged_by_id: { type: 'integer', description: 'The original person who logged this work; unchanged by later corrections.' },
        author: user, logged_by: user,
        canEdit: { type: 'boolean', description: 'Server-decided: the viewer is the worklog author or an org admin (HR admin and above).' },
        canDelete: { type: 'boolean', description: 'Server-decided: the viewer is the worklog author or an org admin (HR admin and above).' },
        day_worked: { type: 'string', format: 'date', description: 'Recorded day worked; never rebucketed in the viewing timezone.' },
        start_time: { type: ['string', 'null'], description: 'Optional local time of day (HH:mm:ss).' },
        minutes: { type: 'integer', minimum: 1 }, comment: { type: ['string', 'null'] },
        created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' }, deleted_at: { type: 'null' },
    });
    schemas.TaskWorklogList = object({ worklogs: { type: 'array', items: ref('TaskWorklog'), description: 'Newest day worked first, then newest created time and id.' }, time_spent_minutes: { type: 'integer', minimum: 0 } });
    schemas.Task.properties.time_spent_minutes = { type: 'integer', minimum: 0, description: 'Sum of non-deleted worklog minutes, computed on read; never stored.' };
    schemas.Task.properties.logged_minutes.description = 'Legacy alias of time_spent_minutes, computed from non-deleted worklogs.';
    const operation = paths['/api/tasks/{id}/worklogs'].get;
    operation.summary = 'List a ticket’s worklogs, author capabilities and computed time spent';
    operation.responses['200'].content['application/json'].schema = ref('TaskWorklogList');
    schemas.LogWorkRequest = {
        type: 'object', additionalProperties: false, required: ['day_worked', 'time_spent'], properties: {
            day_worked: { type: 'string', format: 'date' },
            time_spent: { type: 'string', description: 'Positive duration in w/d/h/m units, with whitespace and decimals. A day uses org work_hours_per_day; a week is five working days. Rounded to whole minutes.' },
            start_time: { type: ['string', 'null'], pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$', description: 'Optional local start time (HH:mm or HH:mm:ss).' },
            comment: { type: ['string', 'null'], maxLength: 10000 },
            author_id: { type: 'integer', minimum: 1, maximum: 2147483647, description: 'Optional person in the same organization. Any supplied author_id, including self, requires can.logWorkForOthers; otherwise 403 WORKLOG_FOR_OTHERS_DENIED. Omit to use the caller on create or keep the author on edit.' },
        },
    };
    schemas.WorklogTicketSummary = object({ id: { type: 'integer' }, time_spent_minutes: { type: 'integer', minimum: 0 },
        logged_minutes: { type: 'integer', minimum: 0, description: 'Legacy alias for time spent.' }, estimated_minutes: { type: ['integer', 'null'], minimum: 0 } });
    schemas.LogWorkResponse = object({ worklog: ref('TaskWorklog'), ticket: ref('WorklogTicketSummary'),
        warnings: { type: 'array', items: { type: 'string', enum: ['ON_LEAVE', 'EXCEEDS_ATTENDANCE'] }, description: 'Advisory checks after commit, never blocking the save. ON_LEAVE means approved leave on the author’s recorded day; EXCEEDS_ATTENDANCE means the author’s non-deleted day total across tickets exceeds attendance working minutes (excluding breaks). No attendance entries means no attendance-total warning. Failed warning reads are best-effort.' } });
    const post = paths['/api/tasks/{id}/worklogs'].post;
    post.summary = 'Log work on a ticket';
    post.description = 'Logs the viewer’s work, or a same-org author for org admins (HR admin and above); done tickets are allowed. Author and original logged-by are separate. History and audit are transactional; task_updated is emitted after commit. Attendance warnings are computed after saving against the saved author and day; failed checks never block or roll back the write. Estimates are a separate rollout ticket.';
    post.requestBody = { required: true, content: { 'application/json': { schema: ref('LogWorkRequest') } } };
    delete post.responses['200'];
    post.responses['201'] = { description: 'Worklog saved', content: { 'application/json': { schema: ref('LogWorkResponse') } } };
    post.responses['400'].description = 'INVALID_DURATION or INVALID_WORKLOG: no work is saved.';
    post.responses['403'].description = 'ACCESS_DENIED, WORKLOG_CANCELLED or WORKLOG_FOR_OTHERS_DENIED: the viewer cannot log work or supplied an author without the behalf capability.';
    schemas.EditWorklogRequest = { ...schemas.LogWorkRequest, required: [], minProperties: 1 };
    schemas.DeleteWorklogRequest = { type: 'object', additionalProperties: false, properties: {} };
    schemas.DeleteWorklogResponse = object({ ticket: ref('WorklogTicketSummary') });
    const edit = paths['/api/tasks/{id}/worklogs/{worklogId}'].patch;
    edit.summary = 'Correct an authored worklog';
    edit.description = 'Accepts changed day worked, duration, start time, comment or author_id. Null clears start time/comment. The author or an org admin may edit; changing author requires can.logWorkForOthers and keeps original logged-by. Done and Cancelled retain corrections. History/audit commit atomically and task_updated is sent after commit. Attendance warnings are recomputed after saving against the saved author/day and updated aggregate; failed checks never block or roll back corrections.';
    edit.requestBody = { required: true, content: { 'application/json': { schema: ref('EditWorklogRequest') } } };
    edit.responses['200'] = { description: 'Worklog corrected', content: { 'application/json': { schema: ref('LogWorkResponse') } } };
    edit.responses['400'].description = 'INVALID_DURATION or INVALID_WORKLOG; nothing is changed.';
    edit.responses['403'].description = 'ACCESS_DENIED or WORKLOG_FOR_OTHERS_DENIED: only the author or an org admin can correct a visible worklog; any supplied author requires the behalf capability.';
    edit.responses['404'] = { description: 'Ticket or active worklog not found in this organization/ticket.', content: { 'application/json': { schema: ref('Error') } } };
    const remove = paths['/api/tasks/{id}/worklogs/{worklogId}'].delete;
    remove.summary = 'Soft-delete an authored worklog';
    remove.description = 'The author or an org admin can delete a visible worklog. Excluded from time spent and daily totals; preserved in history. Audit/history are transactional; task_updated is sent after commit. Remaining modes are deferred.';
    remove.requestBody = { required: false, content: { 'application/json': { schema: ref('DeleteWorklogRequest') } } };
    remove.responses['200'] = { description: 'Worklog soft-deleted', content: { 'application/json': { schema: ref('DeleteWorklogResponse') } } };
    remove.responses['400'].description = 'INVALID_WORKLOG: unsupported fields.';
    remove.responses['403'].description = 'ACCESS_DENIED: only the author or an org admin can delete a visible worklog.';
    remove.responses['404'] = { description: 'Ticket or active worklog not found in this organization/ticket.', content: { 'application/json': { schema: ref('Error') } } };
    schemas.TicketCapability.properties.reason.enum.push('WORKLOG_CANCELLED', 'WORKLOG_FOR_OTHERS_DENIED');
    const can = schemas.TicketCapabilities.properties.can;
    can.properties.logWork = ref('TicketCapability');
    can.required.push('logWork');
    can.properties.logWorkForOthers = ref('TicketCapability');
    can.required.push('logWorkForOthers');
    schemas.TaskTimerStopResponse.properties.minutes.minimum = 1;
    schemas.TaskTimerStopResponse.properties.minutes.description = 'Minutes recorded as one worklog by this stop, rounded up to at least one.';
    for (const [url, method] of [['/api/tasks/{id}/timer', 'get'], ['/api/tasks/{id}/timer/start', 'post'], ['/api/tasks/{id}/timer/stop', 'post']]) {
        paths[url][method].deprecated = true;
        paths[url][method].description = 'Legacy compatibility route. Stopping creates a worklog; response shape is unchanged. Timer removal is deferred until the client-version gate.';
    }
    paths['/api/tracker/task-time'].get.summary = 'Time spent on tasks, grouped by recorded day worked';
}
