import { useCallback, useEffect, useRef, useState } from "react";
import useRealtimeEvent from "../../../hooks/useRealtimeEvent";
import { type DeltaField } from "./taskDeltas";
import { getTaskDetail } from "../../../api/tasks";

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
 * Realtime is an invalidation, never a per-user capability decision.
 */
export function useTaskDeltas(
    setTasks: (updater: (tasks: any[]) => any[]) => void,
    options: { enabled?: boolean; attributionMs?: number; container?: string; onRefresh?: () => void } = {},
) {
    const { enabled = true, attributionMs = 4000, container, onRefresh } = options;
    const [attribution, setAttribution] = useState<Record<string, Attribution>>({});
    // Per-task timestamp of the last delta applied, so an out-of-order frame
    // cannot roll a field back.
    const appliedAt = useRef<Record<string, string>>({});
    const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const requests = useRef<Record<string, number>>({});
    useEffect(() => () => {
        Object.values(timers.current).forEach(clearTimeout);
    }, []);

    const clear = useCallback((taskId: number | string) => {
        setAttribution((current) => {
            if (!(taskId in current)) return current;
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    }, []);

    const onFrame = useCallback(
        async (frame: TaskDeltaFrame) => {
            if (!frame?.taskId) return;
            const key = String(frame.taskId);
            const previous = appliedAt.current[key];
            if (frame.at && previous && frame.at < previous) return;
            if (frame.at) appliedAt.current[key] = frame.at;

            const request = (requests.current[key] || 0) + 1;
            requests.current[key] = request;
            try {
                const { data: fresh } = await getTaskDetail(frame.taskId);
                if (requests.current[key] !== request) return;
                setTasks((tasks) => tasks.map((task) => String(task.id) === key ? fresh : task)
                    .filter((task) => !container || task.container === container));
                onRefresh?.();
            } catch {
                // Keep the last fetched decision on transient failures.
                onRefresh?.();
                return;
            }

            const name = frame.actor?.name;
            if (!name) return;
            setAttribution((current) => ({
                ...current,
                [key]: { name, at: frame.at || new Date().toISOString() },
            }));
            if (timers.current[key]) clearTimeout(timers.current[key]);
            timers.current[key] = setTimeout(() => clear(key), attributionMs);
        },
        [setTasks, attributionMs, clear, container, onRefresh],
    );

    useRealtimeEvent(["task_updated"], (msg) => onFrame(msg.data as TaskDeltaFrame), enabled);

    return { attribution, clearAttribution: clear };
}
