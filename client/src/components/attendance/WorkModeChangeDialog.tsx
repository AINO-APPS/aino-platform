import { useEffect, useState } from "react";
import ConfirmDialog from "../common/ConfirmDialog";
import { submitWorkModeRequest } from "../../api/workforce";

/** Fired by any clock-in path that receives `409 WORK_MODE_LOCKED`. */
export const WORK_MODE_LOCKED_EVENT = "aino-work-mode-locked";

export interface WorkModeLockedDetail {
    lockedMode: string;
    requestedMode: string;
}

const LABEL: Record<string, string> = { office: "Office", remote: "Remote", hybrid: "Hybrid" };
const label = (mode: string) => LABEL[mode] || mode;

/** True (and the dialog is opened) when an API error is the work-mode lock. */
export function handleWorkModeLocked(err: unknown): boolean {
    const data = (err as { response?: { status?: number; data?: { code?: string; locked_mode?: string; requested_mode?: string } } })
        ?.response?.data;
    if (data?.code !== "WORK_MODE_LOCKED") return false;
    window.dispatchEvent(new CustomEvent<WorkModeLockedDetail>(WORK_MODE_LOCKED_EVENT, {
        detail: { lockedMode: data.locked_mode || "office", requestedMode: data.requested_mode || "remote" },
    }));
    return true;
}

/**
 * The first clock-in of the day fixes the work mode. Switching needs a manager
 * approval: this dialog explains that and sends the request.
 */
export default function WorkModeChangeDialog() {
    const [detail, setDetail] = useState<WorkModeLockedDetail | null>(null);
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onLocked = (e: Event) => {
            setDetail((e as CustomEvent<WorkModeLockedDetail>).detail);
            setReason("");
            setError("");
            setSent(false);
        };
        window.addEventListener(WORK_MODE_LOCKED_EVENT, onLocked);
        return () => window.removeEventListener(WORK_MODE_LOCKED_EVENT, onLocked);
    }, []);

    if (!detail) return null;
    const close = () => setDetail(null);

    const submit = async () => {
        if (sent) return close();
        if (busy) return;
        if (!reason.trim()) {
            setError("Please add a reason for your manager.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            await submitWorkModeRequest({ work_mode: detail.requestedMode, reason: reason.trim() });
            setSent(true);
        } catch (err) {
            const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
            setError(msg || "Could not send the request. Please try again.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <ConfirmDialog
            isOpen
            isDanger={false}
            title={sent ? "Request sent" : "Work mode change needs approval"}
            confirmText={sent ? "OK" : busy ? "Sending…" : "Request change"}
            cancelText={sent ? "Close" : "Cancel"}
            onCancel={close}
            onConfirm={submit}
            message={
                sent ? (
                    <p>
                        Your manager has been asked to approve <strong>{label(detail.requestedMode)}</strong> for today.
                        You can clock in as {label(detail.requestedMode)} once it is approved.
                    </p>
                ) : (
                    <div>
                        <p>
                            You already clocked in as <strong>{label(detail.lockedMode)}</strong> today. Working{" "}
                            <strong>{label(detail.requestedMode)}</strong> for the rest of the day needs your manager's approval.
                        </p>
                        <label htmlFor="work-mode-reason" style={{ display: "block", margin: "12px 0 6px", fontSize: 13 }}>
                            Reason
                        </label>
                        <textarea
                            id="work-mode-reason"
                            value={reason}
                            maxLength={500}
                            rows={3}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Leaving office early for a doctor's appointment"
                            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 8, borderRadius: 8, font: "inherit" }}
                        />
                        {error && <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</p>}
                    </div>
                )
            }
        />
    );
}
