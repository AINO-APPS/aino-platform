import { useCallback, useEffect, useState } from "react";
import MessagePopup from "../components/notifications/MessagePopup";
import type { MessageAlert, MessageAlertAction, MessageAlertState } from "../../../desktop/ipc-types";

export default function MessagePopupPage() {
    const [state, setState] = useState<MessageAlertState | null>(null);
    useEffect(() => {
        const bridge = window.electronAPI?.messageAlerts;
        if (!bridge) return;
        const off = bridge.onState((next) => {
            document.documentElement.dataset.theme = next.dark ? "dark" : "light";
            document.documentElement.style.setProperty("--primary", next.primary);
            document.documentElement.style.colorScheme = next.dark ? "dark" : "light";
            document.body.style.background = "transparent";
            setState(next);
        });
        bridge.ready();
        return off;
    }, []);
    useEffect(() => {
        const surface = document.querySelector<HTMLElement>("[data-message-popup]");
        if (!surface || !state) return;
        const resize = () => window.electronAPI?.messageAlerts.resize(Math.ceil(surface.scrollHeight));
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(surface);
        return () => observer.disconnect();
    }, [state]);
    const act = useCallback((action: MessageAlertAction["action"], card: MessageAlert, text?: string) => {
        if (state) window.electronAPI?.messageAlerts.act({ session: state.session, conversationId: card.conversationId,
            messageId: card.messageId, action, text });
    }, [state?.session]);
    return <MessagePopup cards={state?.cards ?? []} act={act} standalone />;
}
