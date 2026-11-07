export default function ArchivedProjectLabel({ task }: { task: any }) {
    return task.project?.is_archived
        ? <span className="badge" title="This project's tickets are read-only. Comments are still open.">Archived project</span>
        : null;
}
