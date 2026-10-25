import React, { useEffect, useState } from "react";
import { GitBranch, GitPullRequest, Code2, ExternalLink } from "../../constants/icons";
import { getTaskGitRefs } from "../../api/tasks";
import s from "./TaskGitRefs.module.css";

interface GitRef {
    id: number | string;
    ref_type: "branch" | "pull_request" | "commit";
    ref_name?: string | null;
    title?: string | null;
    url?: string | null;
    repository?: string | null;
    status?: string | null;
}

const GROUPS: Array<{
    key: "branch" | "pull_request" | "commit";
    label: string;
    icon: typeof GitBranch;
}> = [
    { key: "branch", label: "Branches", icon: GitBranch },
    { key: "pull_request", label: "Pull requests", icon: GitPullRequest },
    { key: "commit", label: "Commits", icon: Code2 },
];

/**
 * Code references linked to a task.
 *
 * These were previously only reachable through the API; the detail surface now
 * lists them so a ticket's branches, PRs and commits are one click away.
 */
export default function TaskGitRefs({ taskId }: { taskId: number | string }) {
    const [refs, setRefs] = useState<GitRef[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        getTaskGitRefs(taskId)
            .then((res) => {
                if (cancelled) return;
                const data = res.data as { refs?: GitRef[] } | GitRef[];
                setRefs(Array.isArray(data) ? data : data?.refs || []);
            })
            .catch(() => {
                if (!cancelled) setRefs([]);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [taskId]);

    if (!loaded || refs.length === 0) return null;

    return (
        <section className={s["git-refs"]} aria-label="Code references">
            <h3 className={s["git-title"]}>Code references</h3>
            {GROUPS.map(({ key, label, icon: Icon }) => {
                const items = refs.filter((ref) => ref.ref_type === key);
                if (items.length === 0) return null;
                return (
                    <div key={key} className={s["git-group"]}>
                        <div className={s["git-group-title"]}>
                            <Icon size={12} aria-hidden="true" /> {label}
                        </div>
                        <ul className={s["git-list"]}>
                            {items.map((ref) => {
                                const text =
                                    ref.ref_name || ref.title || `#${ref.id}`;
                                return (
                                    <li key={ref.id} className={s["git-item"]}>
                                        {ref.url ? (
                                            <a
                                                href={ref.url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className={s["git-link"]}
                                            >
                                                {text}
                                                <ExternalLink
                                                    size={11}
                                                    aria-hidden="true"
                                                />
                                            </a>
                                        ) : (
                                            <span className={s["git-link"]}>{text}</span>
                                        )}
                                        {ref.repository && (
                                            <span className={s["git-repo"]}>
                                                {ref.repository}
                                            </span>
                                        )}
                                        {ref.status && (
                                            <span className={s["git-status"]}>
                                                {ref.status}
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}
