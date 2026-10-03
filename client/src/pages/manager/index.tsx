import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TeamAttendance from "./TeamAttendance";
import ApprovalsTab from "./ApprovalsTab";
import TeamAnalytics from "./TeamAnalytics";
import MyRequests from "./MyRequests";
import EmployeeDashboard from "./EmployeeDashboard";
import s from "../Admin.module.css";

const TAB_IDS = ["attendance", "approvals", "analytics", "requests"];
const tabFromParam = (t: string | null) => (t && TAB_IDS.includes(t) ? t : null);

export default function ManagerDashboard() {
    // Deep links (notifications / push): /manager?tab=approvals&request=<id>
    const [searchParams] = useSearchParams();
    const [tab, setTab] = useState(() => tabFromParam(searchParams.get("tab")) || "attendance");
    const [selectedMember, setSelectedMember] = useState<Record<string, any> | null>(null);
    const highlightRequestId = searchParams.get("request");

    // The page is kept alive between visits, so follow later URL changes too.
    useEffect(() => {
        const t = tabFromParam(searchParams.get("tab"));
        if (t) {
            setTab(t);
            setSelectedMember(null);
        }
    }, [searchParams]);

    if (selectedMember) {
        return (
            <EmployeeDashboard member={selectedMember} onBack={() => setSelectedMember(null)} />
        );
    }

    return (
        <div className={s.adminPage}>
            <h1>Manager Dashboard</h1>
            <div className={s.tabs}>
                <button
                    className={`${s.tab} ${tab === "attendance" ? s.active : ""}`}
                    onClick={() => setTab("attendance")}
                >
                    Team Attendance
                </button>
                <button
                    className={`${s.tab} ${tab === "approvals" ? s.active : ""}`}
                    onClick={() => setTab("approvals")}
                >
                    Approvals
                </button>
                <button
                    className={`${s.tab} ${tab === "analytics" ? s.active : ""}`}
                    onClick={() => setTab("analytics")}
                >
                    Analytics
                </button>
                <button
                    className={`${s.tab} ${tab === "requests" ? s.active : ""}`}
                    onClick={() => setTab("requests")}
                >
                    My Requests
                </button>
            </div>
            {tab === "attendance" && <TeamAttendance onSelectMember={setSelectedMember} />}
            {tab === "approvals" && <ApprovalsTab highlightId={highlightRequestId} />}
            {tab === "analytics" && <TeamAnalytics onSelectMember={setSelectedMember} />}
            {tab === "requests" && <MyRequests />}
        </div>
    );
}