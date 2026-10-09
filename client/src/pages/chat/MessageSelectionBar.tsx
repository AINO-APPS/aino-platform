import { useState } from "react";
import { Copy, Forward, Pin, Star, Trash2, X } from "lucide-react";
import SignalDialog from "../../components/chat/signal/SignalDialog";
import s from "../Chat.module.css";

interface Props {
    count: number;
    canForward: boolean;
    canDeleteForEveryone: boolean;
    onCancel: () => void;
    onCopy: () => void;
    onForward: () => void;
    onPin: () => void;
    onStar: () => void;
    onDeleteForMe: () => void;
    onDeleteForEveryone: () => void;
}

/** Android selection header: ✕ · "N selected" · copy · forward · pin · save · delete (single dialog). */
export default function MessageSelectionBar(p: Props) {
    const [confirm, setConfirm] = useState(false);
    return (
        <div className={s.messageSelectionBar}>
            <button type="button" className={s.selectionIconButton} onClick={p.onCancel} aria-label="Cancel message selection">
                <X size={19} />
            </button>
            <strong>{p.count} selected</strong>
            <div className={s.selectionActions}>
                <button type="button" onClick={p.onCopy} title="Copy selected text" aria-label="Copy">
                    <Copy size={18} />
                </button>
                {p.canForward && (
                    <button type="button" onClick={p.onForward} title="Forward" aria-label="Forward">
                        <Forward size={18} />
                    </button>
                )}
                <button type="button" onClick={p.onPin} title="Pin or unpin selected" aria-label="Pin">
                    <Pin size={18} />
                </button>
                <button type="button" onClick={p.onStar} title="Save or unsave selected" aria-label="Save">
                    <Star size={18} />
                </button>
                <button type="button" className={s.selectionDeleteForMe} onClick={() => setConfirm(true)} title="Delete selected" aria-label="Delete selected">
                    <Trash2 size={18} />
                </button>
            </div>
            {confirm && (
                <DeleteMessagesDialog
                    count={p.count}
                    canDeleteForEveryone={p.canDeleteForEveryone}
                    onDeleteForMe={p.onDeleteForMe}
                    onDeleteForEveryone={p.onDeleteForEveryone}
                    onDismiss={() => setConfirm(false)}
                />
            )}
        </div>
    );
}

/** Android `SignalDeleteDialog`: "Delete for me" / "Delete for everyone" / Cancel. */
export function DeleteMessagesDialog({
    count,
    canDeleteForEveryone,
    onDeleteForMe,
    onDeleteForEveryone,
    onDismiss,
}: {
    count: number;
    canDeleteForEveryone: boolean;
    onDeleteForMe: () => void;
    onDeleteForEveryone: () => void;
    onDismiss: () => void;
}) {
    const close = (fn: () => void) => () => {
        onDismiss();
        fn();
    };
    return (
        <SignalDialog
            title={count === 1 ? "Delete message?" : `Delete ${count} messages?`}
            message={
                canDeleteForEveryone
                    ? "You can delete for yourself or for everyone in this chat."
                    : `This will delete ${count === 1 ? "this message" : "these messages"} from this device.`
            }
            stacked
            onDismiss={onDismiss}
            actions={[
                { label: "Delete for me", danger: true, onClick: close(onDeleteForMe) },
                ...(canDeleteForEveryone ? [{ label: "Delete for everyone", danger: true, onClick: close(onDeleteForEveryone) }] : []),
                { label: "Cancel", onClick: onDismiss },
            ]}
        />
    );
}
