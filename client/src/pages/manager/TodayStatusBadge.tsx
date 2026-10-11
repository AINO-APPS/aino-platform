import React from "react";
import { CircleFilled, CircleOutlined, type IconComponent } from "../../constants/icons";
import { formatMin } from "./constants";
import m from "../ManagerDashboard.module.css";

interface StatusConfigEntry {
    label: string;
    cls: string;
    icon: IconComponent;
}

const config: Record<string, StatusConfigEntry> = {
    working: { label: "Working", cls: "badgeApproved", icon: CircleFilled },
    on_break: { label: "Break", cls: "badgePending", icon: CircleFilled },
    on_leave: { label: "On Leave", cls: "badgeRejected", icon: CircleFilled },
    left: { label: "Left", cls: "badgeDefault", icon: CircleOutlined },
    absent: { label: "Absent", cls: "badgeDefault", icon: CircleFilled },
};

interface TodayStatusBadgeProps {
    status?: string;
    minutes?: number;
}

export default function TodayStatusBadge({ status, minutes }: TodayStatusBadgeProps) {
    const c = (status && config[status]) || config.absent;
    return (
        <div className={m.todayStatus}>
            <span className={`${m.badge} ${m[c.cls]}`}>
                <c.icon size={10} /> {c.label}
            </span>
            {(minutes ?? 0) > 0 && <span className={m.todayMins}>{formatMin(minutes ?? 0)}</span>}
        </div>
    );
}