/**
 * Map the `useBacklog` result onto the prop names `BacklogTab` renders.
 *
 * The hook names its actions `handleScheduleTask`, `toggleCompleted`,
 * `showAllCompleted` and `handleAddBacklog`; the tab expects the `on*` form.
 * Spreading the hook result alone leaves those four props `undefined`, so the
 * tab renders but every click throws "… is not a function". Keeping the
 * mapping in one place means the two names cannot drift apart again.
 */
export interface BacklogTabHandlers {
    onQuickAdd: (title: string) => Promise<void> | void;
    onInlineEdit: (task: any, patch: Record<string, unknown>) => Promise<void> | void;
    onScheduleTask: (...args: any[]) => void;
    onToggleCompleted: () => void;
    onShowAllCompleted: () => void;
    onHandleAddBacklog: (event: React.FormEvent) => void;
}

export function backlogTabHandlers(backlog: any): BacklogTabHandlers {
    return {
        onQuickAdd: backlog.quickAdd,
        onInlineEdit: backlog.inlineEdit,
        onScheduleTask: backlog.handleScheduleTask,
        onToggleCompleted: backlog.toggleCompleted,
        onShowAllCompleted: backlog.showAllCompleted,
        onHandleAddBacklog: backlog.handleAddBacklog,
    };
}
