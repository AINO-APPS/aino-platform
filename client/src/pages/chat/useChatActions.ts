import useMessageActions from "./useMessageActions";
import useConversationActions from "./useConversationActions";
import useCallActions from "./useCallActions";
import type useChatState from "./useChatState";
import { useTypingIndicatorsEnabled } from "./typingPrefs";

type ChatState = ReturnType<typeof useChatState>;

export default function useChatActions(state: ChatState) {
    const { activeConv, typingTimerRef, wsSend } = state;

    const messageActions = useMessageActions(state);
    const conversationActions = useConversationActions(state);
    const callActions = useCallActions(state);
    const typingEnabled = useTypingIndicatorsEnabled();

    const handleTyping = () => {
        if (!activeConv || !typingEnabled) return;
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => {
            wsSend("chat_typing", { conversationId: activeConv.id });
        }, 200);
    };

    return {
        ...messageActions,
        ...conversationActions,
        ...callActions,
        handleTyping,
    };
}