/** Render the selected project's server-decided tabs without deriving type rules. */
import React from "react";
import { CalendarDays, Package, Headset } from "../../constants/icons";
import { planningTabs, type PlanningSurface } from "./hooks/usePlanningSurface";
import type { TasksView } from "./hooks/useTasksRoute";
import s from "./TasksHeader.module.css";

interface PlanningTabsProps {
    planTabs?: TasksView[];
    activeTab: string;
    setActiveTab: (tab: string) => void;
    agileEnabled: boolean;
    backlogCount: number;
    currentSprintId: number | string | null;
    setSelectedSprintId: (id: number | null) => void;
}

const LABELS: Record<TasksView, string> = {
    board: "Board",
    list: "List",
    calendar: "Calendar",
    reports: "Reports",
    sprint: "Sprint",
    backlog: "Backlog",
    scheduled: "Scheduled",
    "service-desk": "Service Desk",
};

/** The icon each tab shows; Sprint has none, the label says enough. */
function TabIcon({ tab }: { tab: TasksView }) {
    const style = { verticalAlign: "middle" as const, marginRight: 4 };
    if (tab === "backlog") return <Package size={14} style={style} />;
    if (tab === "scheduled") return <CalendarDays size={14} style={style} />;
    if (tab === "service-desk") return <Headset size={14} style={style} />;
    return null;
}

export default function PlanningTabs({
    planTabs,
    activeTab,
    setActiveTab,
    agileEnabled,
    backlogCount,
    currentSprintId,
    setSelectedSprintId,
}: PlanningTabsProps) {
    const { tabs, currentSprintId: sprintId }: PlanningSurface = planningTabs({ agileEnabled, currentSprintId, planTabs });
    return (
        <div className={s["tab-switcher"]} role="tablist" aria-label="Tasks views">
            {tabs.map((tab) => (
                <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`${s["tab-btn"]} ${activeTab === tab ? s["tab-active"] : ""}`}
                    title={tab === "scheduled" ? "Unsprinted tickets with a planned day" : undefined}
                    onClick={() => {
                        if (tab === "sprint") setSelectedSprintId(sprintId as number);
                        setActiveTab(tab);
                    }}
                >
                    <TabIcon tab={tab} />
                    {LABELS[tab]}
                    {tab === "backlog" && backlogCount > 0 && (
                        <span className={s["tab-badge"]}>{backlogCount}</span>
                    )}
                </button>
            ))}
        </div>
    );
}
