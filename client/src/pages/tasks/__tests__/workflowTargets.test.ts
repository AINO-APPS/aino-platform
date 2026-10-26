import { describe, expect, test } from "vitest";
import {
    allowedTargetKeys,
    deriveTransitionTargets,
    workflowTargetPolicy,
    workflowTargetReason,
    type WorkflowStateLike,
} from "../hooks/workflowTargets";

const STATES: WorkflowStateLike[] = [
    { id: 10, key: "pending", name: "New", category: "open", is_initial: true, is_terminal: false, sort_order: 1 },
    { id: 11, key: "in_progress", name: "In Progress", category: "in_progress", is_terminal: false, sort_order: 2 },
    { id: 12, key: "in_review", name: "In Review", category: "in_review", is_terminal: false, sort_order: 3 },
    { id: 13, key: "done", name: "Done", category: "done", is_terminal: true, sort_order: 4 },
    { id: 14, key: "cancelled", name: "Cancelled", category: "done", is_terminal: true, sort_order: 5 },
];

function keys(set: Set<string> | undefined): string[] {
    return [...(set ?? [])].sort();
}

function column(key: string, extra: Record<string, unknown> = {}) {
    const state = STATES.find((candidate) => candidate.key === key)!;
    return { ...state, ...extra } as any;
}

function task(stateKey: string) {
    return { id: 1, title: "Ticket", workflow_state_key: stateKey };
}

describe("the board's transition graph", () => {
    test("matches the spec's default matrix", () => {
        expect(keys(allowedTargetKeys("pending", { states: STATES }))).toEqual(["cancelled", "in_progress"]);
        expect(keys(allowedTargetKeys("in_progress", { states: STATES }))).toEqual([
            "cancelled", "done", "in_review", "pending",
        ]);
        expect(keys(allowedTargetKeys("in_review", { states: STATES }))).toEqual([
            "cancelled", "done", "in_progress",
        ]);
        expect(keys(allowedTargetKeys("done", { states: STATES }))).toEqual(["in_progress"]);
        expect(keys(allowedTargetKeys("cancelled", { states: STATES }))).toEqual([]);
    });

    test("custom states derive the same way as the server", () => {
        const states: WorkflowStateLike[] = [
            ...STATES,
            { id: 15, key: "blocked", name: "Blocked", category: "open", is_terminal: false, sort_order: 6 },
            { id: 16, key: "qa", name: "QA", category: "in_review", is_terminal: false, sort_order: 7 },
        ];
        const graph = deriveTransitionTargets(states);
        expect(keys(graph.get("pending"))).toEqual(["blocked", "cancelled", "in_progress"]);
        expect(keys(graph.get("blocked"))).toContain("pending");
        expect(keys(graph.get("qa"))).toContain("done");
        // The initial state still cannot jump straight to Done, but a custom
        // open-category state keeps the §5.3 path to Done.
        expect(keys(graph.get("pending"))).not.toContain("done");
        expect(keys(graph.get("blocked"))).toContain("done");
        // Done reopens into the first in-progress state only.
        expect(keys(graph.get("done"))).toEqual(["in_progress"]);
    });

    test("stored rows override the derivation for their origin", () => {
        const transitions = [{ from_state_id: 10, to_state_id: 14 }];
        expect(keys(allowedTargetKeys("pending", { states: STATES, transitions }))).toEqual(["cancelled"]);
        // Another origin has no rows, so it still derives.
        expect(keys(allowedTargetKeys("in_review", { states: STATES, transitions }))).toEqual([
            "cancelled", "done", "in_progress",
        ]);
    });
});

describe("target refusals", () => {
    const graph = { states: STATES };

    test("an illegal target explains why", () => {
        expect(workflowTargetReason(task("pending"), column("done"), graph)).toBe(
            '"New" cannot move to "Done".',
        );
    });

    test("a legal target is allowed", () => {
        expect(workflowTargetReason(task("pending"), column("in_progress"), graph)).toBeNull();
    });

    test("the current column is always allowed", () => {
        expect(workflowTargetReason(task("pending"), column("pending"), graph)).toBeNull();
    });

    test("cancelled is never a board target", () => {
        expect(workflowTargetReason(task("pending"), column("cancelled"), graph)).toBe(
            "Cancelled is not a board column.",
        );
    });

    test("a ticket with no resolved state does not block the board", () => {
        expect(workflowTargetReason({ id: 2 }, column("done"), graph)).toBeNull();
        expect(workflowTargetReason(task("pending"), { id: 0 } as any, graph)).toBeNull();
    });
});

describe("WIP targets", () => {
    const tasks = [{ id: 1, workflow_state_key: "in_progress" }];
    const graph = { states: STATES };

    test("a full column is refused when WIP limits are on", () => {
        const target = column("in_progress", { wip_limit: 1 });
        const reason = workflowTargetReason(task("pending"), target, graph, tasks, true);
        expect(reason).toContain("WIP limit");
        expect(reason).toContain("(1/1)");
    });

    test("the same column is allowed when WIP limits are off", () => {
        const target = column("in_progress", { wip_limit: 1 });
        expect(workflowTargetReason(task("pending"), target, graph, tasks, false)).toBeNull();
    });

    test("a column with spare capacity is allowed", () => {
        const target = column("in_progress", { wip_limit: 2 });
        expect(workflowTargetReason(task("pending"), target, graph, tasks, true)).toBeNull();
    });
});

describe("the board target policy", () => {
    test("wires the graph and the tenant's WIP setting together", () => {
        const policy = workflowTargetPolicy({
            states: STATES,
            tasks: [{ id: 1, workflow_state_key: "in_progress" }],
            wipEnabled: true,
        });

        expect(policy(task("pending"), column("done"))).toBe('"New" cannot move to "Done".');
        expect(policy(task("pending"), column("in_progress", { wip_limit: 1 }))).toContain("WIP limit");
        expect(policy(task("done"), column("in_review"))).toBe('"Done" cannot move to "In Review".');
        expect(policy(task("done"), column("in_progress"))).toBeNull();
    });
});
