import { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, Search, Share2, UserCheck, X } from "lucide-react";
import { searchChatUsers } from "../../../api/chat";
import { ChatAvatar } from "../../../components/chat";
import SignalDialog from "../../../components/chat/signal/SignalDialog";
import { Divider, MemberRow, SettingsRow, Toggle } from "./SettingsUi";
import { policyLabel, type GroupMember, type GroupPolicy } from "./groupPermissions";
import type { GroupSettingsState } from "./useGroupSettings";
import s from "./GroupSettings.module.css";

/* ─── Edit name / description ─── */
export function EditInfoPage({ gs, onDone }: { gs: GroupSettingsState; onDone: () => void }) {
    const [name, setName] = useState(String(gs.group.group_name || gs.group.name || ""));
    const [desc, setDesc] = useState(String(gs.group.group_description || ""));
    return (
        <>
            <div className={s.body}>
                <div className={s.inner}>
                    <label className={s.field}>
                        <span className={s.fieldLabel}>Group name</span>
                        <input className={s.input} aria-label="Group name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
                    </label>
                    <label className={s.field}>
                        <span className={s.fieldLabel}>Description</span>
                        <textarea className={s.textarea} aria-label="Description" value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
                        <span className={s.counter}>{desc.length}/500</span>
                    </label>
                </div>
            </div>
            <div className={s.footer}>
                <button type="button" className={s.btn} onClick={onDone}>
                    Cancel
                </button>
                <button
                    type="button"
                    className={`${s.btn} ${s.btnPrimary}`}
                    disabled={!name.trim() || gs.busy}
                    onClick={async () => {
                        if (await gs.saveInfo(name, desc)) onDone();
                    }}
                >
                    Save
                </button>
            </div>
        </>
    );
}

/* ─── All members (searchable) ─── */
export function MembersPage({ gs, currentUserId, onMember }: { gs: GroupSettingsState; currentUserId?: number | string; onMember: (m: GroupMember) => void }) {
    const [q, setQ] = useState("");
    const list = useMemo(() => {
        const t = q.trim().toLowerCase();
        return t ? gs.members.filter((m) => `${m.full_name || ""} ${m.username || ""}`.toLowerCase().includes(t)) : gs.members;
    }, [gs.members, q]);
    return (
        <div className={s.body}>
            <div className={s.inner}>
                <div className={s.searchPill}>
                    <Search size={18} />
                    <input placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {list.map((m) => (
                    <MemberRow key={m.id} member={m} currentUserId={currentUserId} onClick={() => onMember(m)} />
                ))}
            </div>
        </div>
    );
}

/* ─── Add members ─── */
export function AddMembersPage({ gs, onDone }: { gs: GroupSettingsState; onDone: () => void }) {
    const [q, setQ] = useState("");
    const [results, setResults] = useState<GroupMember[]>([]);
    const [picked, setPicked] = useState<Map<string, GroupMember>>(new Map());
    const memberIds = useMemo(() => new Set(gs.members.map((m) => String(m.id))), [gs.members]);

    useEffect(() => {
        const t = q.trim();
        if (t.length < 2) {
            setResults([]);
            return;
        }
        const id = setTimeout(() => {
            searchChatUsers(t)
                .then(({ data }) => setResults((data as GroupMember[]).filter((u) => !memberIds.has(String(u.id)))))
                .catch(() => setResults([]));
        }, 220);
        return () => clearTimeout(id);
    }, [q, memberIds]);

    const toggle = (u: GroupMember) =>
        setPicked((prev) => {
            const next = new Map(prev);
            if (next.has(String(u.id))) next.delete(String(u.id));
            else next.set(String(u.id), u);
            return next;
        });

    return (
        <>
            <div className={s.body}>
                <div className={s.inner}>
                    <div className={s.searchPill}>
                        <Search size={18} />
                        <input placeholder="Search people in your organization" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                    </div>
                    {picked.size > 0 && (
                        <div className={s.chips}>
                            {[...picked.values()].map((u) => (
                                <button key={u.id} type="button" className={s.chip} onClick={() => toggle(u)}>
                                    <ChatAvatar name={u.full_name} avatar={u.avatar} size="sm" />
                                    {u.full_name}
                                    <X size={13} />
                                </button>
                            ))}
                        </div>
                    )}
                    {q.trim().length === 1 && <div className={s.note}>Type at least 2 characters</div>}
                    {results.map((u) => (
                        <MemberRow key={u.id} member={u} selected={picked.has(String(u.id))} onClick={() => toggle(u)} />
                    ))}
                </div>
            </div>
            <div className={s.footer}>
                <button type="button" className={s.btn} onClick={onDone}>
                    Cancel
                </button>
                <button
                    type="button"
                    className={`${s.btn} ${s.btnPrimary}`}
                    disabled={picked.size === 0 || gs.busy}
                    onClick={async () => {
                        if (await gs.addMembers([...picked.values()].map((u) => u.id))) onDone();
                    }}
                >
                    Add{picked.size > 0 ? ` (${picked.size})` : ""}
                </button>
            </div>
        </>
    );
}

/* ─── Group link ─── */
export function GroupLinkPage({ gs, onRequests }: { gs: GroupSettingsState; onRequests: () => void }) {
    const [confirmReset, setConfirmReset] = useState(false);
    const link = gs.link;
    const url = link?.token ? `${window.location.origin}/chat/join/${link.token}` : "";
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            gs.flash("Link copied");
        } catch {
            gs.setError("Couldn't copy the link");
        }
    };
    const share = async () => {
        const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
        if (nav.share) await nav.share({ title: String(gs.group.group_name || "Group"), url }).catch(() => undefined);
        else await copy();
    };
    return (
        <div className={s.body}>
            <div className={s.inner}>
                <SettingsRow
                    label="Group link"
                    subtitle="Anyone in your organization with the link can join"
                    trailing={<Toggle on={!!link?.enabled} />}
                    onClick={gs.busy ? undefined : () => void gs.updateLink({ enabled: !link?.enabled })}
                />
                {link?.enabled && url && (
                    <>
                        <div className={s.linkBox}>{url}</div>
                        <SettingsRow icon={<Share2 size={22} />} label="Share" onClick={() => void share()} />
                        <SettingsRow icon={<Copy size={22} />} label="Copy" onClick={() => void copy()} />
                        <SettingsRow icon={<RefreshCw size={22} />} label="Reset link" onClick={() => setConfirmReset(true)} />
                        <Divider />
                        <SettingsRow
                            label="Approve new members"
                            subtitle="Require an admin to approve people joining with the link"
                            trailing={<Toggle on={!!link.requiresApproval} />}
                            onClick={gs.busy ? undefined : () => void gs.updateLink({ requiresApproval: !link.requiresApproval })}
                        />
                        <SettingsRow
                            icon={<UserCheck size={22} />}
                            label="Requests & invites"
                            trailing={link.pendingRequests > 0 ? String(link.pendingRequests) : undefined}
                            onClick={onRequests}
                        />
                    </>
                )}
            </div>
            {confirmReset && (
                <SignalDialog
                    title="Reset link?"
                    message="The current link will stop working. You'll get a new link to share."
                    onDismiss={() => setConfirmReset(false)}
                    actions={[
                        { label: "Cancel", onClick: () => setConfirmReset(false) },
                        {
                            label: "Reset",
                            danger: true,
                            onClick: () => {
                                setConfirmReset(false);
                                void gs.resetLink();
                            },
                        },
                    ]}
                />
            )}
        </div>
    );
}

/* ─── Join requests ─── */
export function RequestsPage({ gs }: { gs: GroupSettingsState }) {
    const { loadRequests } = gs;
    useEffect(() => {
        void loadRequests();
    }, [loadRequests]);
    return (
        <div className={s.body}>
            <div className={s.inner}>
                {gs.requests.length === 0 && <div className={s.note}>No pending requests.</div>}
                {gs.requests.map((r) => (
                    <div key={r.id} className={s.memberRow} style={{ cursor: "default" }}>
                        <ChatAvatar name={r.full_name} avatar={r.avatar} size="md" />
                        <span className={s.rowText}>
                            <span className={s.rowLabel}>{r.full_name || r.username}</span>
                            {r.username && <span className={s.memberRole}>@{r.username}</span>}
                        </span>
                        <button type="button" className={`${s.btn} ${s.danger}`} disabled={gs.busy} onClick={() => void gs.resolveRequest(r, false)}>
                            Deny
                        </button>
                        <button type="button" className={s.btn} disabled={gs.busy} onClick={() => void gs.resolveRequest(r, true)}>
                            Approve
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─── Permissions ─── */
export function PermissionsPage({ gs }: { gs: GroupSettingsState }) {
    const { perms } = gs;
    const [picking, setPicking] = useState<"add" | "post" | null>(null);
    const pick = (policy: GroupPolicy) => {
        const which = picking;
        setPicking(null);
        if (which === "add") void gs.setPolicies({ addPolicy: policy });
        if (which === "post") void gs.setPolicies({ postPolicy: policy });
    };
    return (
        <div className={s.body}>
            <div className={s.inner}>
                <SettingsRow label="Add members" subtitle={policyLabel(perms.addPolicy)} onClick={perms.canChangePolicies ? () => setPicking("add") : undefined} />
                <SettingsRow label="Send messages" subtitle={policyLabel(perms.postPolicy)} onClick={perms.canChangePolicies ? () => setPicking("post") : undefined} />
                <SettingsRow label="Edit group info" subtitle="Only admins" />
                {!perms.canChangePolicies && <div className={s.note}>Only the group owner can change these.</div>}
            </div>
            {picking && (
                <SignalDialog
                    title={picking === "add" ? "Who can add members?" : "Who can send messages?"}
                    stacked
                    onDismiss={() => setPicking(null)}
                    actions={[
                        { label: "All members", onClick: () => pick("all") },
                        { label: "Only admins", onClick: () => pick("admins") },
                        { label: "Cancel", onClick: () => setPicking(null) },
                    ]}
                />
            )}
        </div>
    );
}
