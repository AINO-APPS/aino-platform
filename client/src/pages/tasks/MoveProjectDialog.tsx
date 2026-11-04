import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "../../components/common/ConfirmDialog";
import { getProjects, moveTaskProject, previewTaskProjectMove, type ProjectMovePreview } from "../../api/tasks";
import { writeError } from "./ticketCapabilities";
import s from "./MoveProjectDialog.module.css";

interface Props {
    task: { id: number; project_id: number; ticket_key?: string };
    onClose: () => void;
    onMoved: (task: any) => void;
}

export default function MoveProjectDialog({ task, onClose, onMoved }: Props) {
    const [projects, setProjects] = useState<any[]>([]);
    const [projectId, setProjectId] = useState("");
    const [preview, setPreview] = useState<ProjectMovePreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const requestId = useRef(0);

    useEffect(() => {
        let active = true;
        getProjects().then(({ data }) => {
            if (!active) return;
            const rows = Array.isArray(data) ? data : data.projects || [];
            setProjects(rows.filter((project: any) => Number(project.id) !== Number(task.project_id)
                && !project.is_archived && project.capabilities?.canCreateTickets === true));
        }).catch((failure) => {
            if (active) setError(writeError(failure, "Failed to load projects"));
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; requestId.current++; };
    }, [task.project_id]);

    async function selectProject(value: string) {
        const request = ++requestId.current;
        setProjectId(value);
        setPreview(null);
        setError("");
        if (!value) return;
        try {
            const { data } = await previewTaskProjectMove(task.id, Number(value));
            if (request === requestId.current) setPreview(data);
        } catch (failure) {
            if (request === requestId.current) setError(writeError(failure, "Failed to preview move"));
        }
    }

    async function confirm() {
        if (!preview || pending || preview.target_project_id !== Number(projectId)) return;
        setPending(true);
        setError("");
        try {
            const { data } = await moveTaskProject(task.id, Number(projectId));
            onMoved(data.task);
            onClose();
        } catch (failure) {
            setError(writeError(failure, "Failed to move ticket"));
            setPreview(null);
        } finally {
            setPending(false);
        }
    }

    return <ConfirmDialog
        isOpen title="Move to project" isDanger={false}
        confirmText={pending ? "Moving…" : "Confirm move"}
        confirmDisabled={pending || !preview}
        onCancel={() => { if (!pending) onClose(); }}
        onConfirm={confirm}
        message={<div className={s.content}>
            <p>Move <strong>{task.ticket_key || `#${task.id}`}</strong> to a new project. Its old key will keep working.</p>
            <label className={s.picker}>Destination project
                <select value={projectId} disabled={loading || pending} onChange={(event) => selectProject(event.target.value)}>
                    <option value="">{loading ? "Loading projects…" : "Choose a project…"}</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
            </label>
            {!loading && projects.length === 0 && !error && <p>No other projects allow you to create tickets.</p>}
            <div aria-live="polite">
                {projectId && !preview && !error && <p>Loading preview…</p>}
                {preview && <dl className={s.preview}>
                    <div><dt>New key format</dt><dd className={s.key}>{preview.key_format}</dd></div>
                    <div><dt>Destination status</dt><dd>{preview.workflow_state.name}</dd></div>
                    <div><dt>Sprint</dt><dd>{preview.leaves_sprint ? "Leaves its current sprint" : "No sprint change"}</dd></div>
                </dl>}
            </div>
            {error && <p role="alert" className={s.error}>{error}</p>}
        </div>}
    />;
}
