import { useState, useEffect, useRef } from "react";

const TARGET_HOURS = 9 * 60; // 9 hours in minutes

// Re-anchoring onto a fresh server value within this many seconds of the live
// count would only show request-latency jitter (e.g. 0:41 -> 0:40), so skip it.
const REANCHOR_TOLERANCE_SEC = 2;

interface LiveTimerStatus {
    floorMinutes?: number;
    breakMinutes?: number;
    floorSeconds?: number;
    breakSeconds?: number;
    state?: string;
    [key: string]: unknown;
}

interface Anchor {
    base: number;
    at: number;
}

/**
 * Exact worked/break seconds from a /tracker/status payload. Falls back to
 * whole minutes for servers that predate `floorSeconds` / `breakSeconds`.
 */
export function statusSeconds(
    status: Pick<LiveTimerStatus, "floorMinutes" | "breakMinutes" | "floorSeconds" | "breakSeconds"> | null | undefined,
    kind: "floor" | "break",
): number {
    const seconds = kind === "floor" ? status?.floorSeconds : status?.breakSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds));
    return ((kind === "floor" ? status?.floorMinutes : status?.breakMinutes) || 0) * 60;
}

const liveValue = (anchor: Anchor, now: number) =>
    anchor.base + Math.floor((now - anchor.at) / 1000);

function sendNotification(title: string, body: string): void {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body, icon: "⏱" });
    }
}

/**
 * Custom hook that manages live timer state for the Dashboard.
 * Ticks every second when on_floor or on_break, handles anchoring,
 * 9-hour notification, and confetti trigger.
 */
export function useLiveTimer(status: LiveTimerStatus | null) {
    const [liveFloorSec, setLiveFloorSec] = useState(0);
    const [liveBreakSec, setLiveBreakSec] = useState(0);
    const [showConfetti, setShowConfetti] = useState(false);

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const confettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const notified8hr = useRef(false);
    const confettiTriggered = useRef(false);
    const floorAnchorRef = useRef<Anchor>({ base: 0, at: Date.now() });
    const breakAnchorRef = useRef<Anchor>({ base: 0, at: Date.now() });
    const anchoredStateRef = useRef<string | undefined>(undefined);

    const floorSec = statusSeconds(status, "floor");
    const breakSec = statusSeconds(status, "break");
    const state = status?.state;

    // Anchor baseline whenever the server's seconds or state change (poll,
    // visibility refresh, realtime event, fetch after an action).
    // Also reset notification flags when state becomes logged_out (clock-out) or
    // when the floor resets to near-zero (new day clock-in after previous completion).
    useEffect(() => {
        if (!status) return;
        const now = Date.now();
        const sameState = anchoredStateRef.current === state;
        anchoredStateRef.current = state;
        const anchor = (
            ref: { current: Anchor },
            next: number,
            ticking: boolean,
            set: (value: number) => void,
        ) => {
            if (
                sameState &&
                ticking &&
                Math.abs(next - liveValue(ref.current, now)) <= REANCHOR_TOLERANCE_SEC
            ) {
                return;
            }
            ref.current = { base: next, at: now };
            set(next);
        };
        anchor(floorAnchorRef, floorSec, state === "on_floor", setLiveFloorSec);
        anchor(breakAnchorRef, breakSec, state === "on_break", setLiveBreakSec);
        // Reset notification flags when clocking out or starting a new session
        if (state === "logged_out") {
            notified8hr.current = false;
            confettiTriggered.current = false;
        } else if (floorSec < 60) {
            notified8hr.current = false;
            confettiTriggered.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `status` is only null-checked
    }, [floorSec, breakSec, state]);

    // Live tick every second
    useEffect(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);

        if (status?.state === "on_floor") {
            intervalRef.current = setInterval(() => {
                const next =
                    floorAnchorRef.current.base +
                    Math.floor(
                        (Date.now() - floorAnchorRef.current.at) / 1000,
                    );
                setLiveFloorSec(next);
                if (!notified8hr.current && next >= TARGET_HOURS * 60) {
                    notified8hr.current = true;
                    sendNotification(
                        "🎉 9 Hours Complete!",
                        "You've completed your 9-hour target. Great job!",
                    );
                    if (!confettiTriggered.current) {
                        confettiTriggered.current = true;
                        setShowConfetti(true);
                        confettiTimeoutRef.current = setTimeout(
                            () => setShowConfetti(false),
                            5000,
                        );
                    }
                }
            }, 1000);
        } else if (status?.state === "on_break") {
            intervalRef.current = setInterval(() => {
                const next =
                    breakAnchorRef.current.base +
                    Math.floor(
                        (Date.now() - breakAnchorRef.current.at) / 1000,
                    );
                setLiveBreakSec(next);
            }, 1000);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (confettiTimeoutRef.current)
                clearTimeout(confettiTimeoutRef.current);
        };
    }, [status?.state]);

    // Reset on clock-out
    const reset = () => {
        setLiveFloorSec(0);
        setLiveBreakSec(0);
        notified8hr.current = false;
        confettiTriggered.current = false;
        if (confettiTimeoutRef.current) {
            clearTimeout(confettiTimeoutRef.current);
            confettiTimeoutRef.current = null;
        }
    };

    return { liveFloorSec, liveBreakSec, showConfetti, reset };
}