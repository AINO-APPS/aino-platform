import { STATES, type MeetingState } from "../connectionStateMachine";

/** Preserve the legacy status consumed by MeetingRoom while the FSM is richer. */
export function legacyStatusForMeetingState(state: MeetingState): string {
  return state === STATES.RECONNECTING || state === STATES.DEGRADED
    ? "connecting"
    : state;
}
