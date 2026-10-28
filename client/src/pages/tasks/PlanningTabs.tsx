/**
 * The Tasks tab row.
 *
 * Sprint and Schedule are alternative planning surfaces (see
 * `usePlanningSurface`): a sprint team never sees both. Backlog and Service Desk
 * are common to every team, so they always render.
 */
import React from "react";
import { CalendarDays, Package, Headset } from "../../constants/icons";
import { isSprintEnabled } from "./hooks/usePlanningSurface";
import s from "./TasksHeader.module.css";

interface PlanningTabsProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    currentUser: any;
    agileEnabled: boolean;
    backlogCount: number;
    availableSprints: any[];
    selectedSprintId: number | null;
    setSelectedSprintId: (id: number | null) => void;
}

export default function PlanningTabs({
    activeTab,
    setActiveTab,
    currentUser,
    agileEnabled,
    backlogCount,
    availableSprints,
    selectedSprintId,
    setSelectedSprintId,
}: PlanningTabsProps) {
    const sprintEnabled = isSprintEnabled(currentUser, agileEnabled, availableSprints);
    const button = (tab: string) =>
        `${s["tab-btn"]} ${activeTab === tab ? s["tab-active"] : ""}`;

    return (
        <div className={s["tab-switcher"]}>
            {/* Part of the Agile bundle and gated on the team's sprint config,
                not on the sprint list, which is materialised lazily. */}
            {agileEnabled && sprintEnabled && (
                <button
                    className={button("sprint")}
                    onClick={() => {
                        setActiveTab("sprint");
                        if (!selectedSprintId) {
                            const active = availableSprints.find((sp: any) => sp.status === "active");
                            setSelectedSprintId(active ? active.id : (availableSprints[0]?.id ?? null));
                        }
                    }}
                >
                    Sprint
                </button>
            )}
            <button className={button("backlog")} onClick={() => setActiveTab("backlog")}>
                <Package size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                Backlog{" "}
                {backlogCount > 0 && <span className={s["tab-badge"]}>{backlogCount}</span>}
            </button>
            {/* `/tasks/schedule` still resolves for links, the palette and deep
                links; it is only not offered here. */}
            {!sprintEnabled && (
                <button
                    className={button("scheduled")}
                    onClick={() => setActiveTab("scheduled")}
                    title="Tasks scheduled onto a day — overdue and upcoming"
                >
                    <CalendarDays size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    Scheduled
                </button>
            )}
            <button className={button("service-desk")} onClick={() => setActiveTab("service-desk")}>
                <Headset size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                Service Desk
            </button>
        </div>
    );
}
