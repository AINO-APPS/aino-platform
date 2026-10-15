import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
    type ReactNode,
} from "react";
import { hasTenantContext, useAuth } from "./AuthContext";
import { useToast } from "./components/common/Toast";
import { getNotificationPrefs, updateNotificationPrefs } from "./api/organization";
import {
    DEFAULT_PREFS,
    playSound,
    previewSound,
    type SoundCategory,
} from "./utils/sounds";

export type NotificationPrefs = typeof DEFAULT_PREFS;

interface NotificationPrefsContextValue {
    prefs: NotificationPrefs;
    prefsLoaded: boolean;
    updatePrefs: (partial: Partial<NotificationPrefs>) => void;
    resetPrefs: () => void;
    playRingtone: () => () => void;
    playOutgoing: () => () => void;
    playMessageTone: () => void;
    playMentionTone: () => void;
    playReactionTone: () => void;
    preview: (category: SoundCategory, id: string, volume?: number) => void;
}

const NotificationPrefsContext =
    createContext<NotificationPrefsContextValue | null>(null);

const LS_KEY = "workpulse.notificationPrefs";

function loadFromCache(key: string): Partial<NotificationPrefs> | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
    } catch {
        /* corrupted */
    }
    return null;
}

function saveToCache(key: string, prefs: NotificationPrefs) {
    try {
        localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
        /* quota */
    }
}

export function NotificationPrefsProvider({
    children,
}: {
    children: ReactNode;
}) {
    const { isAuthenticated, user } = useAuth();
    const toast = useToast();
    const tenantReady = isAuthenticated && hasTenantContext(user);
    const cacheKey = `${LS_KEY}:${user?.tenant_id ?? ""}:${user?.id ?? "signed-out"}`;

    // Cache is account-scoped; alerts wait for canonical privacy preferences.
    const initial = useMemo(
        () => ({ ...DEFAULT_PREFS, ...(loadFromCache(cacheKey) || {}) }),
        [cacheKey],
    );
    const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
    const [prefsLoaded, setPrefsLoaded] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSaveRef = useRef<Partial<NotificationPrefs>>({});
    const initialLoadDoneRef = useRef(false);
    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

    // Failed loads keep alerts paused and retry when connectivity/focus returns.
    useEffect(() => {
        setPrefs(initial);
        setPrefsLoaded(false);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        pendingSaveRef.current = {};
        initialLoadDoneRef.current = false;
        if (!tenantReady) return;
        // If the auth profile already shipped notification_prefs, prefer that
        // (avoids the extra round-trip on initial app load).
        const userPrefs = user?.notification_prefs as
            | Partial<NotificationPrefs>
            | undefined;
        if (userPrefs) {
            const merged = { ...DEFAULT_PREFS, ...userPrefs };
            setPrefs(merged);
            saveToCache(cacheKey, merged);
            initialLoadDoneRef.current = true;
            setPrefsLoaded(true);
            return;
        }
        let cancelled = false;
        let loading = false;
        let errorShown = false;
        const load = () => {
            if (loading || initialLoadDoneRef.current) return;
            loading = true;
            getNotificationPrefs()
            .then((res) => {
                if (cancelled) return;
                const merged = { ...DEFAULT_PREFS, ...(res.data || {}) };
                setPrefs(merged);
                saveToCache(cacheKey, merged);
                initialLoadDoneRef.current = true;
                setPrefsLoaded(true);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                console.error("Failed to load notification preferences", error);
                if (!errorShown) toast.error("Message alerts are paused until notification preferences can be loaded.");
                errorShown = true;
            })
            .finally(() => { loading = false; });
        };
        load();
        window.addEventListener("online", load);
        window.addEventListener("focus", load);
        return () => {
            cancelled = true;
            window.removeEventListener("online", load);
            window.removeEventListener("focus", load);
        };
    }, [tenantReady, cacheKey, initial, toast]);

    /**
     * Update prefs locally, persist to localStorage immediately, debounce-save
     * only the changed keys to the server (it merges them with stored prefs),
     * so one stale key can't make every later save fail.
     */
    const updatePrefs = useCallback(
        (partial: Partial<NotificationPrefs>) => {
            setPrefs((prev) => {
                const merged = { ...prev, ...partial };
                saveToCache(cacheKey, merged);
                return merged;
            });

            // Debounce server save (avoid spamming PUT while user drags slider)
            pendingSaveRef.current = { ...pendingSaveRef.current, ...partial };
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
                saveTimerRef.current = null;
                const pending = pendingSaveRef.current;
                pendingSaveRef.current = {};
                if (!tenantReady || Object.keys(pending).length === 0) return;
                updateNotificationPrefs(pending).catch((error: unknown) => {
                    console.error("Failed to save notification preferences", error);
                    toast.error("Notification preferences could not be saved. Please try again.");
                });
            }, 500);
        },
        [tenantReady, cacheKey, toast],
    );

    const resetPrefs = useCallback(() => {
        setPrefs(DEFAULT_PREFS);
        saveToCache(cacheKey, DEFAULT_PREFS);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        pendingSaveRef.current = {};
        if (tenantReady) {
            // Push every default field so the server stores a complete record.
            const { v: _v, ...rest } = DEFAULT_PREFS;
            void _v;
            updateNotificationPrefs(rest).catch((error: unknown) => {
                console.error("Failed to reset notification preferences", error);
                toast.error("Notification preferences could not be reset. Please try again.");
            });
        }
    }, [tenantReady, cacheKey, toast]);

    /* ─── Playback helpers used by the rest of the app ───────────────── */

    const shouldPlay = useCallback(() => {
        if (prefs.muteAll) return false;
        // Slack/Teams default: don't play when the tab is focused unless the
        // user has explicitly opted in.
        if (typeof document !== "undefined") {
            const focused =
                document.visibilityState === "visible" && document.hasFocus();
            if (focused && !prefs.playWhenFocused) return false;
        }
        return true;
    }, [prefs.muteAll, prefs.playWhenFocused]);

    /** Start the incoming-call ringtone (loops). Returns a stop() fn. */
    const playRingtone = useCallback(() => {
        if (prefs.muteAll) return () => {};
        // Ringtones always play (even if window focused) — incoming calls
        // are always urgent.
        return playSound("ringtone", prefs.ringtone, {
            volume: prefs.ringtoneVolume ?? DEFAULT_PREFS.ringtoneVolume,
            loop: true,
        });
    }, [prefs.muteAll, prefs.ringtone, prefs.ringtoneVolume]);

    /** Start the outgoing dial ring-back (loops). Returns a stop() fn. */
    const playOutgoing = useCallback(() => {
        if (prefs.muteAll) return () => {};
        return playSound("outgoing", prefs.outgoingTone, {
            volume: prefs.outgoingVolume ?? DEFAULT_PREFS.outgoingVolume,
            loop: true,
        });
    }, [prefs.muteAll, prefs.outgoingTone, prefs.outgoingVolume]);

    const playMessageTone = useCallback(() => {
        if (!shouldPlay()) return;
        playSound("message", prefs.messageTone, {
            volume: prefs.messageVolume ?? DEFAULT_PREFS.messageVolume,
        });
    }, [shouldPlay, prefs.messageTone, prefs.messageVolume]);

    const playMentionTone = useCallback(() => {
        if (!shouldPlay()) return;
        playSound("mention", prefs.mentionTone, {
            volume: prefs.mentionVolume ?? DEFAULT_PREFS.mentionVolume,
        });
    }, [shouldPlay, prefs.mentionTone, prefs.mentionVolume]);

    const playReactionTone = useCallback(() => {
        if (!shouldPlay()) return;
        playSound("reaction", prefs.reactionTone, {
            volume: prefs.reactionVolume ?? DEFAULT_PREFS.reactionVolume,
        });
    }, [shouldPlay, prefs.reactionTone, prefs.reactionVolume]);

    /** Preview a specific preset id at a specific volume (for the settings UI). */
    const preview = useCallback(
        (category: SoundCategory, id: string, volume?: number) => {
            previewSound(category, id, volume);
        },
        [],
    );

    const value = useMemo(
        () => ({
            prefs,
            prefsLoaded,
            updatePrefs,
            resetPrefs,
            playRingtone,
            playOutgoing,
            playMessageTone,
            playMentionTone,
            playReactionTone,
            preview,
        }),
        [
            prefs,
            prefsLoaded,
            updatePrefs,
            resetPrefs,
            playRingtone,
            playOutgoing,
            playMessageTone,
            playMentionTone,
            playReactionTone,
            preview,
        ],
    );

    return (
        <NotificationPrefsContext.Provider value={value}>
            {children}
        </NotificationPrefsContext.Provider>
    );
}

export function useNotificationPrefs(): NotificationPrefsContextValue {
    const ctx = useContext(NotificationPrefsContext);
    if (!ctx) {
        // Safe fallback so components that may render before the provider
        // mounts don't crash. Returns no-op helpers + defaults.
        return {
            prefs: DEFAULT_PREFS,
            prefsLoaded: false,
            updatePrefs: () => {},
            resetPrefs: () => {},
            playRingtone: () => () => {},
            playOutgoing: () => () => {},
            playMessageTone: () => {},
            playMentionTone: () => {},
            playReactionTone: () => {},
            preview: () => {},
        };
    }
    return ctx;
}