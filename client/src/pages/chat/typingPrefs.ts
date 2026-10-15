import { useNotificationPrefs } from "../../NotificationPrefsContext";

/** Stable empty map shown instead of live typing state when indicators are off. */
export const NO_TYPING: Record<string, number | string> = {};

/** Typing indicators are reciprocal: when off we neither send nor show them. */
export function useTypingIndicatorsEnabled(): boolean {
    return useNotificationPrefs().prefs.typingIndicators !== false;
}
