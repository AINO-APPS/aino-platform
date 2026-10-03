import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApprovals, approveRequest, rejectRequest, bulkApproval } from "../../api/organization";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import ApprovalBadge from "./ApprovalBadge";
import RequestDetails from "./RequestDetails";
import s from "../Admin.module.css";
import sf from "../admin/AdminForms.module.css";
import m from "../ManagerDashboard.module.css";

interface ApprovalRow {
  id: number | string;
  type?: string;
  status?: string;
  created_at: string;
  requester_avatar?: string;
  requester_name?: string;
  metadata?: Record<string, any> | null;
  [key: string]: any;
}

const EMPTY: ApprovalRow[] = [];

interface ApprovalsTabProps {
  /** Approval request id from a notification deep link (?request=<id>). */
  highlightId?: string | null;
}

export default function ApprovalsTab({ highlightId = null }: ApprovalsTabProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [rejectId, setRejectId] = useState<number | string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<number | string | null>(null);
  // Server feedback, e.g. "You cannot approve your own request" or bulk skips.
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const widenedForRef = useRef<string | null>(null);

  const { data: approvals = EMPTY, isLoading: loading } = useQuery({
    queryKey: ["manager", "approvals", filter],
    queryFn: async () =>
      (await getApprovals({ status: filter || undefined }))
        .data as ApprovalRow[],
  });

  // Live refresh when any device/approver changes an approval.
  useRealtimeEvent(["approval_update"], () => {
    queryClient.invalidateQueries({ queryKey: ["manager", "approvals"] });
  });

  const isHighlighted = (a: ApprovalRow) =>
    highlightId != null && String(a.id) === String(highlightId);

  // Deep link: bring the requested row into view. If it is no longer pending
  // (already decided elsewhere) widen the filter once to "All" so it is shown.
  useEffect(() => {
    if (!highlightId || loading) return;
    if (approvals.some(isHighlighted)) {
      highlightRowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    } else if (filter === "pending" && widenedForRef.current !== highlightId) {
      widenedForRef.current = highlightId;
      setFilter("all");
    }
  }, [highlightId, loading, approvals, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshApprovals = () => {
    queryClient.invalidateQueries({ queryKey: ["manager", "approvals"] });
    setSelected(new Set());
  };

  const handleApprove = async (id: number | string) => {
    if (processing) return;
    setProcessing(id);
    setNotice(null);
    try {
      await approveRequest(id as any);
      refreshApprovals();
    } catch (err: any) {
      console.error("Approve failed:", err);
      setNotice({ kind: "error", text: err?.response?.data?.error || "Failed to approve request" });
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async () => {
    if (!rejectId || processing) return;
    setProcessing(rejectId);
    setNotice(null);
    try {
      await rejectRequest(rejectId as any, rejectReason);
      setRejectId(null);
      setRejectReason("");
      refreshApprovals();
    } catch (err: any) {
      console.error("Reject failed:", err);
      setRejectId(null);
      setNotice({ kind: "error", text: err?.response?.data?.error || "Failed to reject request" });
    } finally {
      setProcessing(null);
    }
  };

  const handleBulk = async (action: string) => {
    if (selected.size === 0 || processing) return;
    setProcessing("bulk");
    setNotice(null);
    try {
      const res = await bulkApproval(Array.from(selected) as any, action);
      const data = (res?.data || {}) as { message?: string; skipped?: number };
      if (data.skipped && data.message) setNotice({ kind: "info", text: data.message });
      refreshApprovals();
    } catch (err: any) {
      console.error("Bulk action failed:", err);
      setNotice({ kind: "error", text: err?.response?.data?.error || "Bulk action failed" });
    } finally {
      setProcessing(null);
    }
  };

  const toggleSelect = (id: number | string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === approvals.length) setSelected(new Set());
    else setSelected(new Set(approvals.map((a) => a.id)));
  };

  return (
    <>
      <div className={s.toolbar}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={m["inline-input"]}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
        {filter === "pending" && selected.size > 0 && (
          <div className={m["btn-row"]}>
            <button
              className={s.btnPrimary}
              onClick={() => handleBulk("approve")}
              disabled={!!processing}
            >
              Approve ({selected.size})
            </button>
            <button
              className={s.btnDanger}
              onClick={() => handleBulk("reject")}
              disabled={!!processing}
            >
              Reject ({selected.size})
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className={notice.kind === "error" ? "error-msg" : "info-msg"} role="status">
          {notice.text}
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              {filter === "pending" && (
                <th>
                  <input
                    type="checkbox"
                    checked={
                      selected.size === approvals.length && approvals.length > 0
                    }
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th>Type</th>
              <th>Requester</th>
              <th>Details</th>
              <th>Date</th>
              <th>Status</th>
              {filter === "pending" && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr
                key={a.id}
                ref={isHighlighted(a) ? highlightRowRef : undefined}
                className={isHighlighted(a) ? m["row-highlight"] : undefined}
                data-highlighted={isHighlighted(a) || undefined}
              >
                {filter === "pending" && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                    />
                  </td>
                )}
                <td>
                  <span className={s.badgeRole}>
                    {a.type?.replace("_", " ")}
                  </span>
                </td>
                <td>
                  <div className={s.userCell}>
                    {a.requester_avatar ? (
                      <img
                        src={a.requester_avatar}
                        className={m["avatar-sm-round"]}
                        alt=""
                      />
                    ) : (
                      <span className={s.initials}>
                        {a.requester_name?.charAt(0)}
                      </span>
                    )}
                    <div>
                      <div className={s.userName}>{a.requester_name}</div>
                    </div>
                  </div>
                </td>
                <td className={m["cell-details"]}>
                  <RequestDetails request={a} />
                </td>
                <td className={m["cell-sm"]}>
                  {new Date(a.created_at).toLocaleDateString()}
                </td>
                <td>
                  <ApprovalBadge status={a.status} />
                </td>
                {filter === "pending" && (
                  <td>
                    <div className={s.actions}>
                      <button
                        className={`${s.btnSmall} ${s.btnSuccess}`}
                        onClick={() => handleApprove(a.id)}
                        disabled={!!processing}
                      >
                        {processing === a.id ? "…" : "✓"}
                      </button>
                      <button
                        className={`${s.btnSmall} ${s.btnDanger}`}
                        onClick={() => setRejectId(a.id)}
                        disabled={!!processing}
                      >
                        ✗
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {approvals.length === 0 && (
              <tr>
                <td colSpan={7} className={m["empty-cell"]}>
                  No {filter === "all" ? "" : filter} requests
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {rejectId && (
        <div className={sf.modalOverlay} onClick={() => setRejectId(null)}>
          <div className={sf.modal} onClick={(e) => e.stopPropagation()}>
            <h3>Reject Request</h3>
            <div className={sf.formGroup}>
              <label>Reason (optional)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className={m["textarea-input"]}
                placeholder="Provide a reason..."
              />
            </div>
            <div className={sf.formActions}>
              <button
                className={sf.btnCancel}
                onClick={() => setRejectId(null)}
                disabled={!!processing}
              >
                Cancel
              </button>
              <button
                className={s.btnDanger}
                onClick={handleReject}
                disabled={!!processing}
              >
                {processing ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
