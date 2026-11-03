/** Manual-worklog rollout contract; legacy timer envelopes are unchanged. */
export function applyWorklogContract(paths, schemas) {
    const ref = name => ({ $ref: `#/components/schemas/${name}` });
    const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
    const user = object({ id: { type: 'integer' }, username: { type: 'string' }, full_name: { type: ['string', 'null'] }, avatar: { type: ['string', 'null'] } });
    schemas.TaskWorklog = object({
        id: { type: 'integer' }, task_id: { type: 'integer' }, author_id: { type: 'integer' }, logged_by_id: { type: 'integer' },
        author: user, logged_by: user,
        day_worked: { type: 'string', format: 'date', description: 'Recorded day worked; never rebucketed in the viewing timezone.' },
        start_time: { type: ['string', 'null'], description: 'Optional local time of day (HH:mm:ss).' },
        minutes: { type: 'integer', minimum: 1 }, comment: { type: ['string', 'null'] },
        created_at: { type: 'string', format: 'date-time' }, updated_at: { type: 'string', format: 'date-time' }, deleted_at: { type: 'null' },
    });
    schemas.TaskWorklogList = object({ worklogs: { type: 'array', items: ref('TaskWorklog'), description: 'Newest day worked first, then newest created time and id.' }, time_spent_minutes: { type: 'integer', minimum: 0 } });
    schemas.Task.properties.time_spent_minutes = { type: 'integer', minimum: 0, description: 'Sum of non-deleted worklog minutes, computed on read; never stored.' };
    schemas.Task.properties.logged_minutes.description = 'Legacy alias of time_spent_minutes, computed from non-deleted worklogs.';
    const operation = paths['/api/tasks/{id}/worklogs'].get;
    operation.summary = 'List a ticket’s worklogs and computed time spent (read-only)';
    operation.responses['200'].content['application/json'].schema = ref('TaskWorklogList');
    schemas.LogWorkRequest = {
        type: 'object', additionalProperties: false, required: ['day_worked', 'time_spent'], properties: {
            day_worked: { type: 'string', format: 'date' },
            time_spent: { type: 'string', description: 'Positive duration in w/d/h/m units, with whitespace and decimals. A day uses org work_hours_per_day; a week is five working days. Rounded to whole minutes.' },
            start_time: { type: ['string', 'null'], pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$', description: 'Optional local start time (HH:mm or HH:mm:ss).' },
            comment: { type: ['string', 'null'], maxLength: 10000 },
        },
    };
    schemas.WorklogTicketSummary = object({ id: { type: 'integer' }, time_spent_minutes: { type: 'integer', minimum: 0 },
        logged_minutes: { type: 'integer', minimum: 0, description: 'Legacy alias for time spent.' }, estimated_minutes: { type: ['integer', 'null'], minimum: 0 } });
    schemas.LogWorkResponse = object({ worklog: ref('TaskWorklog'), ticket: ref('WorklogTicketSummary'),
        warnings: { type: 'array', items: { type: 'string' }, description: 'Empty until attendance warnings ship in ticket 06.' } });
    const post = paths['/api/tasks/{id}/worklogs'].post;
    post.summary = 'Log work on a ticket';
    post.description = 'Logs the viewer’s own work; done tickets are allowed. History and audit are transactional; task_updated is emitted after commit. Estimates, behalf logging and attendance warnings are separate rollout tickets.';
    post.requestBody = { required: true, content: { 'application/json': { schema: ref('LogWorkRequest') } } };
    delete post.responses['200'];
    post.responses['201'] = { description: 'Worklog saved', content: { 'application/json': { schema: ref('LogWorkResponse') } } };
    post.responses['400'].description = 'INVALID_DURATION or INVALID_WORKLOG: no work is saved.';
    post.responses['403'].description = 'ACCESS_DENIED or WORKLOG_CANCELLED: the viewer cannot log work on this ticket.';
    schemas.TicketCapability.properties.reason.enum.push('WORKLOG_CANCELLED');
    const can = schemas.TicketCapabilities.properties.can;
    can.properties.logWork = ref('TicketCapability');
    can.required.push('logWork');
    schemas.TaskTimerStopResponse.properties.minutes.minimum = 1;
    schemas.TaskTimerStopResponse.properties.minutes.description = 'Minutes recorded as one worklog by this stop, rounded up to at least one.';
    for (const [url, method] of [['/api/tasks/{id}/timer', 'get'], ['/api/tasks/{id}/timer/start', 'post'], ['/api/tasks/{id}/timer/stop', 'post']]) {
        paths[url][method].deprecated = true;
        paths[url][method].description = 'Legacy compatibility route. Stopping creates a worklog; response shape is unchanged. Timer removal is deferred until the client-version gate.';
    }
    paths['/api/tracker/task-time'].get.summary = 'Time spent on tasks, grouped by recorded day worked';
}
