import { useCallback, useRef, useState } from "react";
import { getSprintBoard } from "../../../api/tasks";
import type { BoardColumn } from "../boardTypes";
import { useTaskDeltas } from "./useTaskDeltas";

interface UseSprintBoardArgs {
    sprintId: number | string | null;
    workflowStates: any[];
    tasks: any[];
    setTasks: React.Dispatch<React.SetStateAction<any[]>>;
    setStats: React.Dispatch<React.SetStateAction<any>>;
    enabled: boolean;
}

export function useSprintBoard({
    sprintId,
    workflowStates,
    tasks,
    setTasks,
    setStats,
    enabled,
}: UseSprintBoardArgs) {
    const [serverColumns, setServerColumns] = useState<any[]>([]);
    const statesRef = useRef(workflowStates);
    statesRef.current = workflowStates;

    const fetchBoard = useCallback(async (signal?: AbortSignal) => {
        if (sprintId == null) return;
        const { data: board } = await getSprintBoard(sprintId, signal);
        const columns = Array.isArray((board as any).columns) ? (board as any).columns : [];
        setTasks(Array.isArray((board as any).tickets) ? (board as any).tickets : []);
        setServerColumns(columns);

        const total = columns.reduce((sum: number, column: any) => sum + column.count, 0);
        const countIn = (category: string) => columns.reduce(
            (sum: number, column: any) =>
                sum + (statesRef.current.find((state: any) =>
                    String(state.id) === String(column.stateId) &&
                    state.category === category,
                ) ? column.count : 0),
            0,
        );
        const done = countIn("done");
        setStats({
            total,
            done,
            inProgress: countIn("in_progress"),
            percent: total > 0 ? Math.round((done / total) * 100) : 0,
        });
    }, [sprintId, setTasks, setStats]);

    const clearColumns = useCallback(() => setServerColumns([]), []);
    const columns: BoardColumn[] = serverColumns.map((column) => {
        const state = workflowStates.find(
            (candidate: any) => String(candidate.id) === String(column.stateId),
        );
        return {
            ...column,
            id: column.stateId,
            key: state?.key,
            name: state?.name ?? `State #${column.stateId}`,
            category: state?.category,
            is_initial: state?.is_initial,
            is_terminal: state?.is_terminal,
            color: state?.color,
        };
    });

    const deltas = useTaskDeltas(setTasks, {
        enabled,
        container: "sprint",
        onRefresh: () => { void fetchBoard().catch(() => {}); },
        shouldRefresh: (frame) => tasks.some(
            (task) => String(task.id) === String(frame.taskId),
        ),
    });

    return { columns, fetchBoard, clearColumns, attribution: deltas.attribution };
}
