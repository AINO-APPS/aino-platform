/**
 * The Tasks tab row.
 *
 * Driven by the selected team's sprint state (see `planningTabs`): a running
 * sprint leads with the Sprint board, Backlog and Scheduled sit beside it; with
 * no active sprint the Sprint tab is hidden. Service Desk always renders.
 */
import React from "react";
import { CalendarDays, Package, Headset } from "../../constants/icons";
import { planningTabs, type PlanningSurface } from "./hooks/usePlanningSurface";
import type { TasksView } from "./hooks/useTasksRoute";
import s from "./TasksHeader.module.css";

interface PlanningTabsProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    agileEnabled: boolean;
    backlogCount: number;
    /** Sprints of the selected team only. */
    availableSprints: any[];
    setSelectedSprintId: (id: number | null) => void;
}

const LABELS: Record<TasksView, string> = {
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
    activeTab,
    setActiveTab,
    agileEnabled,
    backlogCount,
    availableSprints,
    setSelectedSprintId,
}: PlanningTabsProps) {
    const { tabs, activeSprintId }: PlanningSurface = planningTabs({ agileEnabled, sprints: availableSprints });
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
                        if (tab === "sprint") setSelectedSprintId(activeSprintId as number);
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
