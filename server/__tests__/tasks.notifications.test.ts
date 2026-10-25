import {
    describeSprintCompletion,
    describeSprintTaskAdded,
    isDueDateApproaching,
    isSilentAction,
    sprintLink,
    taskAudience,
    taskNotificationLink,
} from "../modules/tasks/tasks.notifications";

describe("task notification events", () => {
    test("a sprint completion says what actually moved", () => {
        expect(
            describeSprintCompletion({
                sprintName: "Sprint 14",
                doneTasks: 8,
                totalTasks: 10,
                velocity: 21,
                rolledOver: 2,
                rolloverTarget: "the backlog",
            }),
        ).toBe("Sprint 14 completed: 8 of 10 tickets done (21 points). 2 tickets carried over to the backlog.");
    });

    test("a clean sprint says nothing carried over", () => {
        expect(
            describeSprintCompletion({
                sprintName: "Sprint 15",
                doneTasks: 5,
                totalTasks: 5,
                velocity: 13,
                rolledOver: 0,
                rolloverTarget: "the backlog",
            }),
        ).toBe("Sprint 15 completed: 5 of 5 tickets done (13 points). Nothing carried over.");
    });

    test("a single carried ticket reads in the singular", () => {
        expect(
            describeSprintCompletion({
                sprintName: "Sprint 16",
                doneTasks: 1,
                totalTasks: 2,
                velocity: 0,
                rolledOver: 1,
                rolloverTarget: "Sprint 17",
            }),
        ).toBe("Sprint 16 completed: 1 of 2 tickets done. 1 ticket carried over to Sprint 17.");
    });

    test("status changes and reordering are silent", () => {
        expect(isSilentAction("status_change")).toBe(true);
        expect(isSilentAction("reordered")).toBe(true);
        expect(isSilentAction("ranked")).toBe(true);
        expect(isSilentAction("task_assigned")).toBe(false);
        expect(isSilentAction(null)).toBe(false);
    });

    test("the audience is the assignee and creator, minus the actor", () => {
        expect(taskAudience({ assigned_to: 3, user_id: 2 }, 9)).toEqual([3, 2]);
        expect(taskAudience({ assigned_to: 3, user_id: 2 }, 3)).toEqual([2]);
        expect(taskAudience({ assigned_to: 3, user_id: 3 }, 3)).toEqual([]);
        expect(taskAudience({ assigned_to: null, user_id: 2 }, 9)).toEqual([2]);
    });

    test("a due date is approaching today or tomorrow only", () => {
        expect(isDueDateApproaching("2026-10-25", "2026-10-25")).toBe(true);
        expect(isDueDateApproaching("2026-10-26", "2026-10-25")).toBe(true);
        expect(isDueDateApproaching("2026-10-27", "2026-10-25")).toBe(false);
        expect(isDueDateApproaching("2026-10-24", "2026-10-25")).toBe(false);
        expect(isDueDateApproaching(null, "2026-10-25")).toBe(false);
        expect(isDueDateApproaching("not-a-date", "2026-10-25")).toBe(false);
    });

    test("every notification deep-links to what it concerns", () => {
        expect(taskNotificationLink(42)).toBe("/tasks?task=42");
        expect(sprintLink(7)).toBe("/tasks/sprint/7");
        // Relative and routable — never an absolute URL.
        expect(taskNotificationLink(42).startsWith("/")).toBe(true);
        expect(sprintLink(7).startsWith("/")).toBe(true);
    });

        /**
         * "Added to a sprint" is one of the five events. It has to be reachable
         * from every path that moves work into a sprint — the single assign route
         * and the bulk move — so the copy and the audience live here rather than
         * being re-written in each route.
         */
        test("being added to a sprint names the sprint and the ticket", () => {
            const added = describeSprintTaskAdded({
                task: { id: 412, title: "Refund webhook retries", assigned_to: 3, user_id: 2 },
                sprint: { name: "Sprint 24" },
                actorId: 88,
            });
            expect(added.title).toBe("Added to Sprint 24");
            expect(added.body).toBe("Refund webhook retries was added to Sprint 24.");
            expect(added.audience).toEqual([3, 2]);
        });

        test("adding your own ticket to a sprint notifies nobody", () => {
            const added = describeSprintTaskAdded({
                task: { id: 412, title: "Self-assigned", assigned_to: 88, user_id: 88 },
                sprint: { name: "Sprint 24" },
                actorId: 88,
            });
            expect(added.audience).toEqual([]);
        });
    });
