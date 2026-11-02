import { describe, test, expect } from "vitest";
import { currentStatusOption, statusOptions } from "../pages/tasks/taskStatus";

describe("status display", () => {
    test("uses default labels without agile config (display only)", () => {
        expect(statusOptions([]).map((option) => option.key)).toEqual(["pending", "in_progress", "in_review", "done"]);
    });

    test("uses org labels and resolves the current state by id first", () => {
        const states = [
            { id: 11, key: "todo", name: "To do", color: "#999" },
            { id: 12, key: "qa", name: "QA", color: "#0af" },
        ];
        const options = statusOptions(states);
        expect(options.map((option) => option.label)).toEqual(["To do", "QA"]);
        expect(currentStatusOption({ workflow_state_key: "todo", workflow_state_id: 12 }, states, options)?.key).toBe("qa");
    });
});
