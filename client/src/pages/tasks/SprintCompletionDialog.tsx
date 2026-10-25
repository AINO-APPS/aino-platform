import React, { useEffect, useState } from "react";
import { getSprintCompletionPreview } from "../../api/tasks";
import s from "./SprintCompletionDialog.module.css";

interface SprintCompletionDialogProps {
    sprintId: number | string;
    sprintName: string;
    onCancel: () => void;
    onConfirm: (target: number | string | "backlog") => void;
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
}: SprintCompletionDialogProps) {
    const [preview, setPreview] = useState<any>(null);
    const [target, setTarget] = useState<number | string | "backlog">("backlog");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        getSprintCompletionPreview(sprintId)
            .then((res) => {
                if (cancelled) return;
                setPreview(res.data);
                setTarget(res.data?.defaultTarget ?? "backlog");
            })
            .catch(() => {
                if (!cancelled) setPreview(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [sprintId]);

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

                {!loading && preview && (
                    <>
                        <section className={s["section"]}>
                            <h3 className={s["section-title"]}>
                                Moves ({preview.moving.length} · {preview.movingPoints} pts)
                            </h3>
                            <ul className={s["list"]}>
                                {preview.moving.map((task: any) => (
                                    <li key={task.id}>{task.title}</li>
                                ))}
                                {preview.moving.length === 0 && (
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
                                    const value = event.target.value;
                                    setTarget(value === "backlog" ? "backlog" : value);
                                }}
                            >
                                <option value="backlog">Backlog</option>
                                {preview.defaultTarget !== "backlog" && (
                                    <option value={String(preview.defaultTarget)}>
                                        Next planned sprint
                                    </option>
                                )}
                            </select>
                        </label>
                    </>
                )}

                <div className={s["actions"]}>
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={loading}
                        onClick={() => onConfirm(target)}
                    >
                        Complete sprint
                    </button>
                </div>
            </div>
        </div>
    );
}
