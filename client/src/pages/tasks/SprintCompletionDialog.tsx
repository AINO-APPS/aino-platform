import React, { useEffect, useState } from "react";
import {
    getSprintCompletionPreview,
    type SprintCompletionPreview,
    type SprintCompletionTarget,
} from "../../api/tasks";
import s from "./SprintCompletionDialog.module.css";

interface SprintCompletionDialogProps {
    sprintId: number | string;
    sprintName: string;
    onCancel: () => void;
    onConfirm: (target: SprintCompletionTarget) => void;
    busy?: boolean;
    error?: string;
}

/**
 * The carryover pre-flight.
 *
 * Shows what will move, where to, and what stays before anything happens. The
 * default target is the next planned sprint, otherwise the backlog, and it can
 * be overridden.
 */
export default function SprintCompletionDialog({
    sprintId,
    sprintName,
    onCancel,
    onConfirm,
    busy = false,
    error,
}: SprintCompletionDialogProps) {
    const [preview, setPreview] = useState<SprintCompletionPreview | null>(null);
    const [target, setTarget] = useState<SprintCompletionTarget>("backlog");
    const [loading, setLoading] = useState(true);
    const [targetLoading, setTargetLoading] = useState(false);
    const [previewError, setPreviewError] = useState(false);
    const supportsNewSprint = preview?.supportsNewSprint === true;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setPreview(null);
        setTarget("backlog");
        setPreviewError(false);
        getSprintCompletionPreview(sprintId)
            .then((res) => {
                if (cancelled) return;
                setPreview(res.data);
                setTarget(res.data?.supportsNewSprint === true
                    ? res.data.selectedTarget ?? (res.data.defaultTarget === "backlog" ? "backlog" : "next")
                    : res.data?.defaultTarget ?? "backlog");
            })
            .catch(() => {
                if (!cancelled) {
                    setPreview(null);
                    setPreviewError(true);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [sprintId]);

    useEffect(() => {
        if (!supportsNewSprint || typeof target !== "string"
            || !["next", "new", "backlog"].includes(target)) return;
        let cancelled = false;
        setTargetLoading(true);
        setPreviewError(false);
        getSprintCompletionPreview(sprintId, target)
            .then((res) => {
                if (!cancelled) setPreview(res.data);
            })
            .catch(() => {
                if (!cancelled) setPreviewError(true);
            })
            .finally(() => {
                if (!cancelled) setTargetLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [sprintId, target, supportsNewSprint]);

    const movingParents = preview?.movingParents ?? preview?.moving ?? [];
    const movingSummary = supportsNewSprint
        ? `${movingParents.length} parents · ${preview.movingSubtasks ?? 0} subtasks · ${preview.movingPoints} pts`
        : `${preview?.moving.length ?? 0} · ${preview?.movingPoints ?? 0} pts`;

    return (
        <div className={s["backdrop"]} role="presentation" onClick={onCancel}>
            <div
                className={s["dialog"]}
                role="dialog"
                aria-modal="true"
                aria-labelledby="completion-title"
                onClick={(event) => event.stopPropagation()}
            >
                <h2 id="completion-title" className={s["title"]}>
                    Complete {sprintName}
                </h2>

                {loading && <p className={s["muted"]}>Working out what moves…</p>}
                {!loading && previewError && (
                    <p className={s["muted"]}>Could not load the server preview. Try again before completing.</p>
                )}
                {error && <p className={s["muted"]} role="alert">{error}</p>}

                {!loading && preview && (
                    <>
                        <section className={s["section"]}>
                            <h3 className={s["section-title"]}>
                                Moves ({movingSummary})
                            </h3>
                            <ul className={s["list"]}>
                                {movingParents.map((task) => (
                                    <li key={task.id}>{task.title}</li>
                                ))}
                                {movingParents.length === 0 && (
                                    <li className={s["muted"]}>Nothing to carry over.</li>
                                )}
                            </ul>
                        </section>

                        <section className={s["section"]}>
                            <h3 className={s["section-title"]}>
                                Stays with this sprint ({preview.staying.length})
                            </h3>
                            <ul className={s["list"]}>
                                {preview.staying.map((task: any) => (
                                    <li key={task.id}>{task.title}</li>
                                ))}
                                {preview.staying.length === 0 && (
                                    <li className={s["muted"]}>No finished work.</li>
                                )}
                            </ul>
                        </section>

                        <label className={s["target"]}>
                            <span>Move unfinished work to</span>
                            <select
                                value={String(target)}
                                onChange={(event) => {
                                    setTarget(event.target.value);
                                }}
                            >
                                {supportsNewSprint ? (
                                    <>
                                        <option value="next" disabled={!preview.hasNext}>
                                            Next planned sprint{preview.nextPlannedSprint ? ` — ${preview.nextPlannedSprint.name}` : ""}
                                        </option>
                                        <option value="new">New planned sprint</option>
                                        <option value="backlog">Backlog</option>
                                    </>
                                ) : (
                                    <>
                                        <option value="backlog">Backlog</option>
                                        {preview.defaultTarget !== "backlog" && (
                                            <option value={String(preview.defaultTarget)}>Next planned sprint</option>
                                        )}
                                    </>
                                )}
                            </select>
                        </label>
                        {target === "new" && preview.newSprint && (
                            <p className={s["muted"]}>
                                {preview.newSprint.name}: {preview.newSprint.start_date} – {preview.newSprint.end_date}
                            </p>
                        )}
                    </>
                )}

                <div className={s["actions"]}>
                    <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading || targetLoading || previewError || !preview || busy}
                        onClick={() => onConfirm(target)}
                    >
                        Complete sprint
                    </button>
                </div>
            </div>
        </div>
    );
}
