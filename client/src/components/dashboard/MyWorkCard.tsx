import React, { memo, useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, CalendarDays } from "../../constants/icons";
import { useAuth } from "../../AuthContext";
import { useFeatures } from "../../FeaturesContext";
import useWebSocket from "../../hooks/useWebSocket";
import { getActiveSprint, getSprintTasks, getTasks } from "../../api/tasks";
import {
    capGroups,
    myDoneCount,
    myOpenTasks,
    myWorkCount,
    overdueFrom,
    previousWeekEnd,
    rowDayLabel,
    sprintGroups,
    stateLabel,
    stateTone,
    weekGroups,
    weekRange,
    type MyWorkGroup,
    type MyWorkTask,
} from "./myWork";
import s from "./MyWorkCard.module.css";

/** The fields the card uses from `GET /sprints/active`. */
interface SprintData {
    id: number | string;
    name: string;
}

/**
 * The home "My Work" card: the viewer's tickets in the running sprint, or the
 * ones planned into this week.
 *
 * Replaces `SprintProgressCard`, which showed the backlog whenever it could not
 * show a sprint. The backlog is gone from home in both modes: a section whose
 * meaning flips when the data changes was the confusion ADR-015 exists to end.
 */
const MyWorkCard = memo(function MyWorkCard() {
    const { user } = useAuth();
    const { hasFeature } = useFeatures();
    const navigate = useNavigate();
    const [sprint, setSprint] = useState<SprintData | null>(null);
    const [groups, setGroups] = useState<MyWorkGroup[]>([]);
    const [hidden, setHidden] = useState(0);
    const [counts, setCounts] = useState({ done: 0, total: 0 });
    const [loaded, setLoaded] = useState(false);
    /** The lookup failed — an outage must not read as "you have nothing to do". */
    const [failed, setFailed] = useState(false);
    const cancelledRef = useRef(false);

    const loadWeek = useCallback(async (userId: number | string) => {
        const range = weekRange();
        const overdueEnd = previousWeekEnd(range.start);
        // Two narrow range queries rather than the whole scheduled set: the
        // overdue window is bounded so ancient slipped work cannot crowd the card.
        const [weekRes, overdueRes] = await Promise.all([
            getTasks(undefined, { start_date: range.start, end_date: range.end, assignee: "me" }),
            // A failed Overdue lookup costs the Overdue group only: this week's
            // rows are still the answer to the question the card asks.
            getTasks(undefined, { start_date: overdueFrom(range.start), end_date: overdueEnd, assignee: "me" })
                .catch(() => null),
        ]);
        if (cancelledRef.current) return;

        const weekRows = (weekRes.data.tasks as MyWorkTask[]) || [];
        const overdueRows = (overdueRes?.data.tasks as MyWorkTask[]) || [];
        const capped = capGroups(weekGroups(myOpenTasks(overdueRows, userId), myOpenTasks(weekRows, userId), range.start));
        setGroups(capped.groups);
        setHidden(capped.hidden);
        setCounts({ done: myDoneCount(weekRows, userId), total: myWorkCount(weekRows, userId) });
    }, []);

    const loadSprint = useCallback(async (running: SprintData, userId: number | string) => {
        const taskRes = await getSprintTasks(running.id);
        if (cancelledRef.current) return;
        // The sprint endpoint returns the whole sprint; "my work" is the subset
        // assigned to me, exactly as the counts beside it are.
        const rows = (taskRes.data.tasks as MyWorkTask[]) || [];
        const capped = capGroups(sprintGroups(myOpenTasks(rows, userId)));
        setGroups(capped.groups);
        setHidden(capped.hidden);
        setCounts({ done: myDoneCount(rows, userId), total: myWorkCount(rows, userId) });
    }, []);

    const loadCard = useCallback(async () => {
        if (!user) return;
        try {
            let running: SprintData | null = null;
            // "Agile & Sprints" gate: the active-sprint lookup 403s when the
            // tenant lacks the feature, so skip the call entirely.
            if (hasFeature("agile")) {
                const { data } = await getActiveSprint();
                if (cancelledRef.current) return;
                running = (data.sprint as SprintData) || null;
            }
            if (running) {
                setSprint(running);
                await loadSprint(running, user.id);
            } else {
                setSprint(null);
                await loadWeek(user.id);
            }
            if (!cancelledRef.current) setFailed(false);
        } catch (err: any) {
            if (cancelledRef.current) return;
            if (err?.response?.status === 403) {
                // A mid-session feature toggle 403s the sprint call: fall to the
                // week, which is the other half of the same rule, not the backlog.
                setSprint(null);
                try {
                    await loadWeek(user.id);
                } catch {
                    if (!cancelledRef.current) setFailed(true);
                }
            } else {
                // Anything else is an outage. Saying "nothing planned" here would
                // tell someone with a full week that they have no work.
                setFailed(true);
            }
        } finally {
            if (!cancelledRef.current) setLoaded(true);
        }
    }, [user, hasFeature, loadSprint, loadWeek]);

    useEffect(() => {
        cancelledRef.current = false;
        loadCard();
        return () => { cancelledRef.current = true; };
    }, [loadCard]);

    // Refresh when the window regains focus — covers reassigning a ticket in
    // another tab and coming back.
    useEffect(() => {
        const onFocus = () => { loadCard(); };
        const onVisibility = () => { if (!document.hidden) loadCard(); };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [loadCard]);

    useWebSocket(useCallback((msg: any) => {
        if (msg.type === "task_assigned" || msg.type === "task_updated") loadCard();
    }, [loadCard]));

    const openAll = useCallback(() => {
        navigate(sprint ? `/tasks?tab=sprint&sprint_id=${sprint.id}` : "/tasks?tab=scheduled");
    }, [navigate, sprint]);

    if (!loaded) {
        return (
            <div className={`status-card ${s.card}`}>
                <div className={s.skeleton} />
            </div>
        );
    }

    const empty = groups.every((group) => group.tasks.length === 0);

    return (
        <div
            className={`status-card ${s.card} ${s.clickable}`}
            onClick={openAll}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && openAll()}
        >
            <h3 className={s.title}>
                <span className="page-icon">{sprint ? <Zap size={18} /> : <CalendarDays size={18} />}</span>
                <span className={s["title-text"]}>{sprint ? sprint.name : "This Week"}</span>
                {counts.total > 0 && (
                    <span className={s["done-count"]}>{counts.done} of {counts.total} done</span>
                )}
                <span className={s.arrow}>›</span>
            </h3>

            {empty ? (
                <p className={s["empty-text"]}>
                    {failed
                        ? "Could not load your tickets."
                        : sprint
                            ? "No tickets assigned to you in this sprint."
                            : "Nothing planned for this week."}
                </p>
            ) : (
                <div className={s.list}>
                    {groups.map((group) => (
                        <div key={group.key} className={s.group}>
                            {group.label && <span className={s["group-label"]}>{group.label}</span>}
                            {group.tasks.map((task) => (
                                <div
                                    key={task.id}
                                    className={s.item}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => { e.stopPropagation(); navigate(`/tasks?task=${task.id}`); }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") { e.stopPropagation(); navigate(`/tasks?task=${task.id}`); }
                                    }}
                                >
                                    <span className={`${s.dot} ${s[`t-${stateTone(task)}`]}`} />
                                    <span className={s["item-title"]}>{task.title}</span>
                                    {/* Only Overdue rows need a day: elsewhere the group header names it. */}
                                    {rowDayLabel(task, group.key) && (
                                        <span className={s["row-day"]}>{rowDayLabel(task, group.key)}</span>
                                    )}
                                    <span className={s.state}>{stateLabel(task)}</span>
                                    {task.priority && (
                                        <span className={`${s.priority} ${s[`p-${task.priority}`] ?? ""}`}>
                                            {task.priority}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                    {hidden > 0 && (
                        <span
                            className={s.more}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); openAll(); }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openAll(); } }}
                        >
                            ＋{hidden} more
                        </span>
                    )}
                </div>
            )}
        </div>
    );
});

export default MyWorkCard;
