import { useCallback, useRef, useState } from "react";
import useRealtimeEvent from "../../../hooks/useRealtimeEvent";
import { applyTaskDelta, type DeltaField } from "./taskDeltas";

export interface TaskDeltaFrame {
    taskId: number;
    action?: string;
    fields?: Partial<Record<DeltaField, unknown>>;
    actor?: { id: number; name: string | null } | null;
    at?: string;
}

export interface Attribution {
    name: string;
    at: string;
}

/**
 * Apply realtime field deltas to the tasks a view already holds.
 *
 * Only the fields in the frame are patched, so two people editing different
 * fields of the same ticket both survive. The later write wins per field, and
 * the affected card gets a short-lived "Updated by <name>" attribution that
 * never blocks interaction.
 */
export function useTaskDeltas(
    setTasks: (updater: (tasks: any[]) => any[]) => void,
    options: { enabled?: boolean; attributionMs?: number } = {},
) {
    const { enabled = true, attributionMs = 4000 } = options;
    const [attribution, setAttribution] = useState<Record<string, Attribution>>({});
    // Per-task timestamp of the last delta applied, so an out-of-order frame
    // cannot roll a field back.
    const appliedAt = useRef<Record<string, string>>({});
    const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const clear = useCallback((taskId: number | string) => {
        setAttribution((current) => {
            if (!(taskId in current)) return current;
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    }, []);

    const onFrame = useCallback(
        (frame: TaskDeltaFrame) => {
            if (!frame?.taskId || !frame.fields) return;
            const key = String(frame.taskId);
            const previous = appliedAt.current[key];
            if (frame.at && previous && frame.at < previous) return;
            if (frame.at) appliedAt.current[key] = frame.at;

            setTasks((tasks) =>
                tasks.map((task) =>
                    String(task.id) === key
                        ? applyTaskDelta(task, { fields: frame.fields!, at: frame.at }, previous)
                        : task,
                ),
            );

            const name = frame.actor?.name;
            if (!name) return;
            setAttribution((current) => ({
                ...current,
                [key]: { name, at: frame.at || new Date().toISOString() },
            }));
            if (timers.current[key]) clearTimeout(timers.current[key]);
            timers.current[key] = setTimeout(() => clear(key), attributionMs);
        },
        [setTasks, attributionMs, clear],
    );

    useRealtimeEvent(["task_updated"], (msg) => onFrame(msg.data as TaskDeltaFrame), enabled);

    return { attribution, clearAttribution: clear };
}
