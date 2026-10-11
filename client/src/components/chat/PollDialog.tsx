import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
    children: ReactNode;
    onClose: () => void;
    dismissDisabled?: boolean;
    className: string;
}

export default function PollDialog({ children, onClose, dismissDisabled = false, className }: Props) {
    const overlay = useRef<HTMLDivElement>(null);
    const dismiss = useRef({ onClose, dismissDisabled });
    dismiss.current = { onClose, dismissDisabled };
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const focusable = () => Array.from(overlay.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
        const dialog = () => overlay.current?.querySelector<HTMLElement>('[role="dialog"]');
        const focusFirst = () => (overlay.current?.querySelector<HTMLElement>("[data-poll-autofocus]:not(:disabled)") || focusable()[0] || dialog())?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                if (!dismiss.current.dismissDisabled) dismiss.current.onClose();
            }
            if (event.key !== "Tab") return;
            const elements = focusable();
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (!first) { event.preventDefault(); dialog()?.focus(); return; }
            if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            }
        };
        const onFocus = (event: FocusEvent) => {
            if (!overlay.current?.contains(event.target as Node)) focusFirst();
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("focusin", onFocus);
        focusFirst();
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("focusin", onFocus);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return createPortal(
        <div ref={overlay} className={className} onClick={event => {
            event.stopPropagation();
            if (event.target === event.currentTarget && !dismissDisabled) onClose();
        }} onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
            {children}
        </div>, document.body);
}
