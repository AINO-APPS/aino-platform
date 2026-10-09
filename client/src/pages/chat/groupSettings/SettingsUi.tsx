import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { ChatAvatar } from "../../../components/chat";
import { roleBadge, type GroupMember } from "./groupPermissions";
import s from "./GroupSettings.module.css";

export function TopBar({ title, onBack, trailing }: { title: string; onBack: () => void; trailing?: ReactNode }) {
    return (
        <div className={s.topBar}>
            <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Back">
                <ArrowLeft size={22} />
            </button>
            <span className={s.topTitle}>{title}</span>
            {trailing}
        </div>
    );
}

export function SettingsRow({
    icon,
    label,
    subtitle,
    trailing,
    danger,
    accent,
    onClick,
}: {
    icon?: ReactNode;
    label: string;
    subtitle?: string;
    trailing?: ReactNode;
    danger?: boolean;
    accent?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            type="button"
            className={`${s.row} ${danger ? s.danger : ""} ${accent ? s.accent : ""}`}
            onClick={onClick}
            disabled={!onClick}
        >
            {icon !== undefined && <span className={s.rowIcon}>{icon}</span>}
            <span className={s.rowText}>
                <span className={s.rowLabel}>{label}</span>
                {subtitle && <span className={s.rowSub}>{subtitle}</span>}
            </span>
            {trailing !== undefined && <span className={s.rowTrailing}>{trailing}</span>}
        </button>
    );
}

export function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" className={s.quick} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

export const Divider = () => <div className={s.divider} />;
export const SectionTitle = ({ children }: { children: ReactNode }) => <div className={s.sectionTitle}>{children}</div>;

export function Toggle({ on }: { on: boolean }) {
    return <span className={`${s.toggle} ${on ? s.toggleOn : ""}`} aria-hidden="true" />;
}

export function MemberRow({
    member,
    currentUserId,
    onClick,
    selected,
}: {
    member: GroupMember;
    currentUserId?: number | string | null;
    onClick?: () => void;
    selected?: boolean;
}) {
    const isSelf = currentUserId != null && String(member.id) === String(currentUserId);
    const name = isSelf ? "You" : member.full_name || member.username || "Member";
    const badge = roleBadge(member.role);
    return (
        <button type="button" className={s.memberRow} onClick={onClick} aria-pressed={selected}>
            <ChatAvatar name={member.full_name || member.username} avatar={member.avatar} size="md" />
            <span className={s.rowText}>
                <span className={s.rowLabel}>{name}</span>
                {member.username && !badge && <span className={s.memberRole}>@{member.username}</span>}
                {badge && <span className={`${s.memberRole} ${s.accent}`}>{badge}</span>}
            </span>
            {selected !== undefined && (
                <span className={`${s.check} ${selected ? s.checkOn : ""}`}>{selected && <Check size={14} strokeWidth={3} />}</span>
            )}
        </button>
    );
}
