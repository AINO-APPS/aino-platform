import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Timer } from "../../constants/icons";
import { getTaskTime } from "../../api/tasks";
import { formatMinutes } from "../tasks/time";
import s from "./Analytics.module.css";

interface TaskTimeEntry {
    task_id: number;
    title: string;
    issue_key: string | null;
    date: string;
    minutes: number;
}

interface TaskTimeDay {
    date: string;
    minutes: number;
    entries: TaskTimeEntry[];
}

/**
 * Time logged against tasks, per day.
 *
 * A timer started from a task lands here once it stops, so the timesheet shows
 * the same minutes the task shows.
 */
export default function TaskTimeTable({ from, to }: { from: string; to: string }) {
    const { data, isLoading } = useQuery({
        queryKey: ["task-time", from, to],
        queryFn: async () => {
            const res = await getTaskTime(from, to);
            return (res.data as TaskTimeDay[]) || [];
        },
        enabled: !!from && !!to,
    });

    const days = data ?? [];
    const total = days.reduce((sum, day) => sum + day.minutes, 0);

    return (
        <div className={`${s["chart-card"]} ${s["history-full"]}`}>
            <h3 style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Timer size={17} /> Task time
                {total > 0 && (
                    <span className={s["task-time-total"]}>{formatMinutes(total)}</span>
                )}
            </h3>
            <div className={s["table-scroll-wrapper"]}>
                <table className={s["history-table"]}>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Task</th>
                            <th>Logged</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={3} className={s["empty-cell"]}>
                                    Loading task time…
                                </td>
                            </tr>
                        ) : days.length === 0 ? (
                            <tr>
                                <td colSpan={3} className={s["empty-cell"]}>
                                    No task time logged in this period
                                </td>
                            </tr>
                        ) : (
                            days.flatMap((day) =>
                                day.entries.map((entry, index) => (
                                    <tr key={`${day.date}-${entry.task_id}`}>
                                        <td className={s["date-cell"]}>
                                            {index === 0
                                                ? new Date(
                                                      day.date + "T00:00:00",
                                                  ).toLocaleDateString("en-US", {
                                                      weekday: "short",
                                                      month: "short",
                                                      day: "numeric",
                                                  })
                                                : ""}
                                        </td>
                                        <td>
                                            {entry.issue_key && (
                                                <span className={s["task-time-key"]}>
                                                    {entry.issue_key}
                                                </span>
                                            )}{" "}
                                            {entry.title}
                                        </td>
                                        <td>{formatMinutes(entry.minutes)}</td>
                                    </tr>
                                )),
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
