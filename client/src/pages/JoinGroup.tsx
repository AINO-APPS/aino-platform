import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cancelGroupJoinRequest, getGroupInvite, joinGroupInvite } from "../api/chat";

interface InvitePreview {
    conversationId: number;
    name: string | null;
    description: string | null;
    avatar: string | null;
    memberCount: number;
    requiresApproval: boolean;
    alreadyMember: boolean;
    pending: boolean;
}

const box: React.CSSProperties = {
    maxWidth: 380,
    margin: "12vh auto",
    padding: 28,
    borderRadius: 16,
    background: "var(--bg-elevated)",
    color: "var(--text)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
};
const button = (primary: boolean): React.CSSProperties => ({
    padding: "10px 22px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    background: primary ? "var(--primary)" : "var(--bg-hover)",
    color: primary ? "#fff" : "var(--text)",
});

/** `/chat/join/:token` — preview a group from its invite link, then join or ask to join. */
export default function JoinGroup() {
    const { token = "" } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const [invite, setInvite] = useState<InvitePreview | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        getGroupInvite(token)
            .then(({ data }) => setInvite(data))
            .catch((err) => setError(err?.response?.data?.error || "This invite link is no longer valid."));
    }, [token]);

    const openChat = (id: number) => navigate(`/chat?conv=${id}`, { replace: true });

    const join = async () => {
        setBusy(true);
        try {
            const { data } = await joinGroupInvite(token);
            if (data.pending) setInvite((prev) => (prev ? { ...prev, pending: true } : prev));
            else openChat(data.conversationId);
        } catch (err: any) {
            setError(err?.response?.data?.error || "Couldn't join this group.");
        }
        setBusy(false);
    };

    const cancel = async () => {
        setBusy(true);
        try {
            await cancelGroupJoinRequest(token);
            setInvite((prev) => (prev ? { ...prev, pending: false } : prev));
        } catch {
            /* keep the pending state; the user can retry */
        }
        setBusy(false);
    };

    if (error) {
        return (
            <div style={box}>
                <h2 style={{ margin: 0 }}>Can't open group link</h2>
                <p style={{ color: "var(--text-secondary)" }}>{error}</p>
                <button style={button(false)} onClick={() => navigate("/chat")}>Back to chat</button>
            </div>
        );
    }
    if (!invite) return <div style={box}>Loading…</div>;

    const title = invite.name || "Group";
    return (
        <div style={box}>
            {invite.avatar ? (
                <img src={invite.avatar} alt="" style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
                <div style={{ width: 88, height: 88, borderRadius: "50%", background: "var(--primary)", color: "#fff", display: "grid", placeItems: "center", fontSize: 34, fontWeight: 700 }}>
                    {title.trim().charAt(0).toUpperCase()}
                </div>
            )}
            <h2 style={{ margin: "6px 0 0" }}>{title}</h2>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Group · {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
            </div>
            {invite.description && <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>{invite.description}</p>}
            {invite.alreadyMember ? (
                <button style={button(true)} onClick={() => openChat(invite.conversationId)}>Open chat</button>
            ) : invite.pending ? (
                <>
                    <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Your request to join is waiting for an admin to approve it.</p>
                    <button style={button(false)} disabled={busy} onClick={cancel}>Cancel request</button>
                </>
            ) : (
                <>
                    {invite.requiresApproval && (
                        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>An admin of this group must approve your request.</p>
                    )}
                    <button style={button(true)} disabled={busy} onClick={join}>
                        {invite.requiresApproval ? "Request to join" : "Join group"}
                    </button>
                </>
            )}
        </div>
    );
}
