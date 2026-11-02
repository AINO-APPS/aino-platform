export {};

/**
 * The enforced ticket lifecycle.
 *
 * The transition graph is derived from the workflow states (spec §5.3) and may
 * be overridden row-by-row in `workflow_transitions`. These tests pin the
 * default graph from the spec matrix, the custom-state derivation, and the two
 * ways a move can be refused: an illegal transition and a full WIP column.
 */

import {
    allowsTransition,
    buildLifecycleContext,
    deriveTransitions,
    effectiveTransitions,
    type LifecycleContext,
    type WorkflowState,
} from "../modules/tasks/tasks.workflow";

const DEFAULT_STATES: WorkflowState[] = [
    { id: 10, key: "pending", name: "New", category: "open", is_initial: true, is_terminal: false, sort_order: 1 },
    { id: 11, key: "in_progress", name: "In Progress", category: "in_progress", is_terminal: false, sort_order: 2 },
    { id: 12, key: "in_review", name: "In Review", category: "in_review", is_terminal: false, sort_order: 3 },
    { id: 13, key: "done", name: "Done", category: "done", is_terminal: true, sort_order: 4 },
    { id: 14, key: "cancelled", name: "Cancelled", category: "done", is_terminal: true, sort_order: 5 },
];

function edgeSet(edges: Array<{ from: number; to: number }>): string[] {
    return edges
        .map((edge) => `${edge.from}->${edge.to}`)
        .sort();
}

function context(
    states: WorkflowState[] = DEFAULT_STATES,
    transitions: Array<{ from: number; to: number }> = [],
    wipEnabled = false,
): LifecycleContext {
    return buildLifecycleContext(states, transitions, wipEnabled);
}

describe("the default transition graph", () => {
    test("matches the spec matrix exactly", () => {
        // New → In Progress; In Progress → In Review, New, Done;
        // In Review → In Progress, Done; Done → In Progress (reopen);
        // any non-terminal → Cancelled; Cancelled terminal; Done ⇸ Cancelled.
        expect(edgeSet(deriveTransitions(DEFAULT_STATES))).toEqual([
            "10->11", "10->14",
            "11->10", "11->12", "11->13", "11->14",
            "12->11", "12->13", "12->14",
            "13->11",
        ]);
    });

    test("the spec matrix is accepted and its inverse is refused", () => {
        const ctx = context();
        expect(allowsTransition(ctx, 10, 11)).toBe(true);
        expect(allowsTransition(ctx, 11, 13)).toBe(true);
        expect(allowsTransition(ctx, 13, 11)).toBe(true);
        expect(allowsTransition(ctx, 10, 14)).toBe(true);

        // New cannot jump straight to Done.
        expect(allowsTransition(ctx, 10, 13)).toBe(false);
        // Done cannot be cancelled.
        expect(allowsTransition(ctx, 13, 14)).toBe(false);
        // Cancelled has no exit.
        expect(allowsTransition(ctx, 14, 10)).toBe(false);
        // In Review does not fall all the way back to New.
        expect(allowsTransition(ctx, 12, 10)).toBe(false);
    });

    test("a no-op move is always allowed", () => {
        expect(allowsTransition(context(), 11, 11)).toBe(true);
    });
});

describe("custom states", () => {
    const STATES: WorkflowState[] = [
        ...DEFAULT_STATES,
        { id: 15, key: "blocked", name: "Blocked", category: "open", is_terminal: false, sort_order: 6 },
        { id: 16, key: "qa", name: "QA", category: "in_review", is_terminal: false, sort_order: 7 },
    ];

    test("same-category states move freely in both directions", () => {
        const ctx = context(STATES);
        expect(allowsTransition(ctx, 10, 15)).toBe(true); // two open states
        expect(allowsTransition(ctx, 15, 10)).toBe(true);
        expect(allowsTransition(ctx, 12, 16)).toBe(true); // two review states
        expect(allowsTransition(ctx, 16, 12)).toBe(true);
    });

    test("a secondary open state may finish work; the initial one may not", () => {
        const ctx = context(STATES);
        expect(allowsTransition(ctx, 15, 11)).toBe(true); // Blocked → In Progress
        // §5.3 keeps "to any state in done from any active state" for custom
        // states, so Blocked can finish. New is the initial state and the
        // default matrix forbids New → Done.
        expect(allowsTransition(ctx, 15, 13)).toBe(true);
        expect(allowsTransition(ctx, 10, 13)).toBe(false);
    });

    test("active work may jump to any Done state and to review", () => {
        const ctx = context(STATES);
        expect(allowsTransition(ctx, 11, 16)).toBe(true); // forward to review
        expect(allowsTransition(ctx, 16, 13)).toBe(true); // review to done
        expect(allowsTransition(ctx, 11, 13)).toBe(true); // in progress to done
    });

    test("Done reopens to the first in-progress state only", () => {
        const states: WorkflowState[] = [
            ...STATES,
            { id: 17, key: "rework", name: "Rework", category: "in_progress", is_terminal: false, sort_order: 8 },
        ];
        const ctx = context(states);
        expect(allowsTransition(ctx, 13, 11)).toBe(true);
        expect(allowsTransition(ctx, 13, 17)).toBe(false);
    });

    test("every non-terminal state can be cancelled", () => {
        const ctx = context(STATES);
        for (const id of [10, 11, 12, 15, 16]) {
            expect(allowsTransition(ctx, id, 14)).toBe(true);
        }
        // Done cannot.
        expect(allowsTransition(ctx, 13, 14)).toBe(false);
    });
});

describe("explicit transition rows", () => {
    test("a row for the origin state overrides the derived graph", () => {
        // An admin narrowed New to only Cancelled: the derived New → In Progress
        // edge must no longer apply.
        const ctx = context(DEFAULT_STATES, [{ from: 10, to: 14 }]);
        expect(allowsTransition(ctx, 10, 14)).toBe(true);
        expect(allowsTransition(ctx, 10, 11)).toBe(false);
    });

    test("the effective graph exposes rows plus derivation to the client", () => {
        const ctx = context(DEFAULT_STATES, [{ from: 10, to: 14 }]);
        const edges = effectiveTransitions(ctx).map((edge) => `${edge.from}->${edge.to}`);
        // The explicit row wins for its origin...
        expect(edges).toContain("10->14");
        expect(edges).not.toContain("10->11");
        // ...and an origin with no rows is still reachable.
        expect(edges).toContain("11->12");
    });

    test("a state with no rows falls back to the derived graph", () => {
        // The org predates the migration, or Blocked was added afterwards.
        const custom: WorkflowState[] = [
            ...DEFAULT_STATES,
            { id: 15, key: "blocked", name: "Blocked", category: "open", is_terminal: false },
        ];
        const ctx = context(custom, [{ from: 10, to: 11 }]);
        expect(allowsTransition(ctx, 15, 11)).toBe(true);
        expect(allowsTransition(ctx, 15, 14)).toBe(true);
    });

    test("an unknown state is not second-guessed", () => {
        // The states could not be loaded (inactive/deleted); refuse nothing.
        expect(allowsTransition(context(), 999, 10)).toBe(true);
        expect(allowsTransition(context(), null, 10)).toBe(true);
    });
});
