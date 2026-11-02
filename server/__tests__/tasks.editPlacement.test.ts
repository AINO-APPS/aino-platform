import { editPlacement } from "../modules/tasks/tasks.sprintAssignment";

describe("where an edit moves a ticket", () => {
    const unsprinted = { currentSprintId: null, currentPlannedDate: null };
    const scheduled = { currentSprintId: null, currentPlannedDate: "2026-11-05" };
    const sprinted = { currentSprintId: 50, currentPlannedDate: "2026-11-05" };

    test("an edit that touches neither sprint nor day moves nothing", () => {
        expect(editPlacement({ ...scheduled })).toEqual({ target: null, plannedAfter: "2026-11-05", joinsSprint: false });
    });

    test("joining a sprint keeps the planned day and says the due date will follow the sprint", () => {
        expect(editPlacement({ ...scheduled, requestedSprint: { id: 60 } }))
            .toEqual({ target: { sprint: 60 }, plannedAfter: "2026-11-05", joinsSprint: true });
    });

    test("leaving a sprint is a sprint move that does not join", () => {
        expect(editPlacement({ ...sprinted, requestedSprint: null }))
            .toEqual({ target: { sprint: null }, plannedAfter: "2026-11-05", joinsSprint: false });
    });

    test("a sprint change wins over a planned day in the same request", () => {
        expect(editPlacement({ ...unsprinted, requestedSprint: { id: 60 }, requestedPlannedDate: "2026-11-09" }).target)
            .toEqual({ sprint: 60 });
    });

    test("a valid day plans an unsprinted ticket", () => {
        expect(editPlacement({ ...unsprinted, requestedPlannedDate: "2026-11-09" }))
            .toEqual({ target: { day: "2026-11-09" }, plannedAfter: "2026-11-09", joinsSprint: false });
    });

    test.each([[null], [""], ["9 Nov"]])("a cleared or invalid day (%p) returns an unsprinted ticket to the backlog", (day) => {
        expect(editPlacement({ ...scheduled, requestedPlannedDate: day as string | null }))
            .toEqual({ target: "backlog", plannedAfter: null, joinsSprint: false });
    });

    test("'no sprint' on an unsprinted ticket is not a sprint change, so a planned day in the same edit applies", () => {
        // The detail editor always sends sprint_id, as null when there is none.
        expect(editPlacement({ ...unsprinted, requestedSprint: null, requestedPlannedDate: "2026-11-09" }))
            .toEqual({ target: { day: "2026-11-09" }, plannedAfter: "2026-11-09", joinsSprint: false });
    });

    test("resending the ticket's own sprint moves nothing and does not count as joining", () => {
        expect(editPlacement({ ...sprinted, requestedSprint: { id: 50 } }))
            .toEqual({ target: null, plannedAfter: "2026-11-05", joinsSprint: false });
    });

    test("a planned day on a sprinted ticket is ignored: the sprint outranks it", () => {
        expect(editPlacement({ ...sprinted, requestedPlannedDate: "2026-11-09" }))
            .toEqual({ target: null, plannedAfter: "2026-11-05", joinsSprint: false });
    });
});
