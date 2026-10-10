import React, { memo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Check, X } from "lucide-react";
import { getApprovals, approveRequest, rejectRequest } from "../../api/organization";
import { refreshApprovalQueries } from "../../hooks/useApprovalSync";
import { useToast } from "../common/Toast";
import s from "./PendingApprovalsCard.module.css";

interface Approval {
    id: number | string;
    type: string;
    requester_name?: string;
    requester_username?: string;
    [key: string]: unknown;
}

function formatType(type: string): string {
    switch (type) {
        case "leave": return "Leave";
        case "manual_entry": return "Manual Entry";
        case "overtime": return "Overtime";
        case "leave_withdraw": return "Leave Withdraw";
        case "work_mode_change": return "Work Mode Change";
        default: return type;
    }
}

const PendingApprovalsCard = memo(function PendingApprovalsCard() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();
    const { data: approvals = [], isLoading: loading, isError } = useQuery({
        queryKey: ["manager", "approvals", "pending"],
        queryFn: async () => (await getApprovals({ status: "pending" })).data as Approval[],
        refetchOnMount: "always",
    });
    const [actioning, setActioning] = useState<number | string>("");

    const handleApprove = async (id: number | string) => {
        if (actioning !== "") return;
        setActioning(id);
        try {
            await approveRequest(id);
            await refreshApprovalQueries(queryClient).catch((err: unknown) => {
                console.error("Approval refresh failed:", err);
                toast.error("Request approved, but approvals could not be refreshed.");
            });
        } catch (err: unknown) {
            console.error("Approve failed:", err);
            toast.error("Failed to approve request.");
        }
        finally { setActioning(""); }
    };

    const handleReject = async (id: number | string) => {
        if (actioning !== "") return;
        setActioning(id);
        try {
            await rejectRequest(id);
            await refreshApprovalQueries(queryClient).catch((err: unknown) => {
                console.error("Approval refresh failed:", err);
                toast.error("Request rejected, but approvals could not be refreshed.");
            });
        } catch (err: unknown) {
            console.error("Reject failed:", err);
            toast.error("Failed to reject request.");
        }
        finally { setActioning(""); }
    };

    if (isError) return <p className="error-msg" role="alert">Could not refresh pending approvals.</p>;
    if (loading || approvals.length === 0) return null;

    // Count by type
    const counts: Record<string, number> = {};
    approvals.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
    const countParts = Object.entries(counts).map(([t, c]) => `${c} ${formatType(t)}`);

    const preview = approvals.slice(0, 3);

    return (
        <div
            className={`status-card ${s.card}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate("/manager")}
            onKeyDown={(e) => e.key === "Enter" && navigate("/manager")}
        >
            <h3 className={s.title}>
                <span className="page-icon"><ClipboardCheck size={18} /></span> Pending Approvals
                <span className={s.count}>{approvals.length}</span>
            </h3>

            <p className={s.breakdown}>{countParts.join(" · ")}</p>

            <div className={s.list}>
                {preview.map((a) => (
                    <div key={a.id} className={s.item} onClick={(e) => e.stopPropagation()}>
                        <div className={s.itemInfo}>
                            <span className={s.itemName}>{a.requester_name || a.requester_username}</span>
                            <span className={s.itemType}>{formatType(a.type)}</span>
                        </div>
                        <div className={s.actions}>
                            <button
                                className={`${s.actionBtn} ${s.approve}`}
                                onClick={() => handleApprove(a.id)}
                                disabled={!!actioning}
                                title="Approve"
                            >
                                <Check size={13} />
                            </button>
                            <button
                                className={`${s.actionBtn} ${s.reject}`}
                                onClick={() => handleReject(a.id)}
                                disabled={!!actioning}
                                title="Reject"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {approvals.length > 3 && (
                <p className={s.viewAll}>View All →</p>
            )}
        </div>
    );
});

export default PendingApprovalsCard;