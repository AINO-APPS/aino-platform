import { useDragDrop } from "./useDragDrop";
import { useBoardDragWiring } from "./useBoardDragWiring";
import type { BoardColumn } from "../boardTypes";
import type { ShowConfirm } from "./useConfirmDialog";

interface UseSprintBoardDragArgs {
    tasks: any[];
    setTasks: React.Dispatch<React.SetStateAction<any[]>>;
    columns: BoardColumn[];
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    setError: (message: string) => void;
    onBoardRefresh: () => void;
}

export function useSprintBoardDrag({
    tasks,
    setTasks,
    columns,
    showConfirm,
    closeConfirm,
    setError,
    onBoardRefresh,
}: UseSprintBoardDragArgs) {
    const drag = useDragDrop({
        tasks,
        setTasks,
        showConfirm,
        closeConfirm,
        setError,
        onBoardRefresh,
    });
    const { boardDrag, announcement } = useBoardDragWiring({
        tasks,
        columns,
        showConfirm,
        closeConfirm,
        onMove: (task, column) => drag.commitMove(task, column),
    });
    return { drag, boardDrag, announcement };
}
