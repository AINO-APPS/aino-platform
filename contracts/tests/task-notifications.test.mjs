import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// The task events worth a notification, and the actions that must stay silent.
// These assertions pin the set so a new emitter cannot quietly add another
// event, or start notifying on reordering.
const NOTIFICATION_EVENTS = [
  "task_assigned",
  "sprint_task_added",
  "sprint_started",
  "sprint_completed",
  "status_changed",
  "due_date_approaching",
];

test("the notification module declares exactly the task events", () => {
  const source = read("server/modules/tasks/tasks.notifications.ts");
  const start = source.indexOf("export type TaskNotificationEvent =");
  const end = source.indexOf(";", start);
  const declared = [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(declared.sort(), [...NOTIFICATION_EVENTS].sort());
});

test("reordering is declared silent; a status change is not", () => {
  const source = read("server/modules/tasks/tasks.notifications.ts");
  const start = source.indexOf("export const SILENT_ACTIONS = [");
  const end = source.indexOf("] as const;", start);
  const silent = [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(silent.sort(), ["ranked", "reordered"]);
});

test("every lifecycle write path notifies through the one status helper", () => {
  for (const file of [
    "server/routes/tasks/crud.ts",
    "server/routes/tasks/bulk.ts",
    "server/routes/tasks/cancel.ts",
  ]) {
    const source = read(file);
    assert.ok(
      source.includes("announceStatusMove"),
      `${file} does not use the shared status side-effect helper`,
    );
  }
  // The audience is the assignee and reporter, minus the actor — never the
  // whole team.
  const helper = read("server/routes/tasks/_helpers/statusEvents.ts");
  assert.ok(helper.includes("notifyStatusChanged"), "status helper must notify");
  assert.ok(helper.includes("describeStatusChanged"), "status helper must use the shared copy");
  const notifications = read("server/modules/tasks/tasks.notifications.ts");
  const describe = notifications.indexOf("export function describeStatusChanged");
  assert.ok(describe > -1, "describeStatusChanged missing");
  assert.ok(
    notifications.slice(describe, describe + 900).includes("taskAudience"),
    "a status change must scope its audience",
  );
});

test("no task route notifies on a reorder", () => {
  for (const file of [
    "server/routes/tasks/crud.ts",
    "server/routes/tasks/rank.ts",
    "server/routes/tasks/bulk.ts",
  ]) {
    const source = read(file);
    assert.ok(
      !/notifyUser\([^)]*reordered/.test(source),
      `${file} notifies on a reorder`,
    );
  }
});

test("every notification deep-links to a relative, routable path", () => {
  const links = read("server/utils/notificationLinks.ts");
  assert.ok(links.includes("export function taskLink"), "taskLink missing");
  const notifications = read("server/modules/tasks/tasks.notifications.ts");
  assert.ok(notifications.includes("export function sprintLink"), "sprintLink missing");
  // Both must build a leading-slash path, never an absolute URL.
  assert.ok(/return `\/tasks\?task=/.test(links), "taskLink must be relative");
  assert.ok(/return `\/tasks\/sprint\//.test(notifications), "sprintLink must be relative");
});

test("the sprint-completion body summarises what moved", () => {
  const source = read("server/modules/tasks/tasks.notifications.ts");
  assert.ok(source.includes("export function describeSprintCompletion"));
  for (const marker of ["doneTasks", "totalTasks", "rolledOver", "rolloverTarget"]) {
    assert.ok(source.includes(marker), `completion summary missing ${marker}`);
  }
});

test("the sprint start and complete routes emit their notifications", () => {
  const source = read("server/routes/sprints.ts");
  assert.ok(source.includes("notifySprintStarted"), "sprint start does not notify");
  assert.ok(source.includes("notifySprintCompleted"), "sprint complete does not notify");
  const helper = read("server/routes/_helpers/sprintNotifications.ts");
  assert.ok(helper.includes("sprintLink"), "sprint notifications must deep-link");
});

test("being added to a sprint notifies the assignee", () => {
  const source = read("server/routes/tasks/sprints.ts");
  assert.ok(source.includes("notifySprintTaskAdded"), "assign-sprint does not notify");
  // The audience and the copy live in one place so both the single assign and
  // the bulk move emit the identical event.
  const notifications = read("server/modules/tasks/tasks.notifications.ts");
  assert.ok(
    notifications.includes("export function describeSprintTaskAdded"),
    "the added-to-sprint event must be declared once, in the notifications module",
  );
  assert.ok(notifications.includes("taskAudience"), "added-to-sprint must scope the audience");
});

test("bulk move-to-sprint emits the same added-to-sprint event", () => {
  const source = read("server/routes/tasks/bulk.ts");
  assert.ok(source.includes("describeSprintTaskAdded"), "bulk move does not notify");
  // Moving work OUT of a sprint is not "added to a sprint".
  assert.ok(
    /sprintId !== null[\s\S]{0,120}notifyBulkSprintAdded/.test(source),
    "bulk move must only notify when a sprint is actually set",
  );
});

test("a due-date reminder sweep exists and is scheduled", () => {
  const jobs = read("server/jobs.ts");
  assert.ok(jobs.includes("runDueDateReminderSweep"), "due-date sweep missing");
  assert.ok(jobs.includes('"due-date-reminders"'), "due-date sweep not scheduled");
  assert.ok(jobs.includes("isDueDateApproaching"), "due-date sweep must use the shared rule");
});
