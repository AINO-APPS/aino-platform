interface Props {
    lockedWorkMode: string | null;
    workModeRequest: { status: string; workMode: string; rejectReason?: string | null } | null;
}

const LABEL: Record<string, string> = { office: "Office", remote: "Remote", hybrid: "Hybrid" };

/** One line under the Office/Remote toggle explaining today's locked mode. */
export default function WorkModeLockHint({ lockedWorkMode, workModeRequest }: Props) {
    if (!lockedWorkMode) return null;
    const locked = LABEL[lockedWorkMode] || lockedWorkMode;
    const requested = workModeRequest ? LABEL[workModeRequest.workMode] || workModeRequest.workMode : "";
    let text = `Today: ${locked}. Switching needs manager approval.`;
    if (workModeRequest?.status === "pending") text = `Today: ${locked}. ${requested} requested, waiting for approval.`;
    else if (workModeRequest?.status === "approved") text = `${requested} approved for the rest of today.`;
    else if (workModeRequest?.status === "rejected") {
        text = `Today: ${locked}. ${requested} request was rejected${workModeRequest.rejectReason ? `: ${workModeRequest.rejectReason}` : "."}`;
    }
    return (
        <p role="status" style={{ fontSize: 12, color: "var(--text-secondary)", margin: "6px 0 0", textAlign: "center" }}>
            {text}
        </p>
    );
}

interface ModeStatus {
    state?: string;
    workMode?: string;
    lockedWorkMode?: string | null;
    workModeRequest?: { status: string; workMode: string } | null;
}

/**
 * Mode to preselect: while logged out, today's locked mode (or an approved
 * switch) so the next clock-in is not refused; otherwise the current session's.
 */
export function preferredWorkMode(status: ModeStatus | null | undefined): string | null {
    if (!status) return null;
    if (status.state && status.state !== "logged_out") return status.workMode || null;
    const approved = status.workModeRequest?.status === "approved" ? status.workModeRequest.workMode : null;
    return approved || status.lockedWorkMode || status.workMode || null;
}