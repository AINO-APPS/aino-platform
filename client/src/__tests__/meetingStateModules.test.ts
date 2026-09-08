import { describe, expect, it, vi } from "vitest";
import {
  createClientMessageId,
  normalizeChatText,
} from "../pages/meeting/state/chat";
import { legacyStatusForMeetingState } from "../pages/meeting/state/lifecycle";
import { buildMeetingMediaProfiles } from "../pages/meeting/state/media";
import {
  addParticipantToMap,
  removeParticipantFromMap,
} from "../pages/meeting/state/participants";
import {
  buildMuteParticipantPayload,
  buildRaiseHandPayload,
} from "../pages/meeting/state/moderation";
import { clearPeerRecoveryTimers } from "../pages/meeting/state/reconnect";
import { stopScreenStream } from "../pages/meeting/state/screenShare";
import {
  applyPublicTurnPolicy,
  hasRealTurn,
  queueSignalingFrame,
} from "../pages/meeting/state/signaling";
import {
  selectPriorityVideoPeers,
  videoBitrateForPeerCount,
} from "../pages/meeting/state/quality";

describe("meeting-state extracted policies", () => {
  it("preserves chat id generation and whitespace handling", () => {
    expect(
      createClientMessageId({
        randomUUID: () => "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe("00000000-0000-4000-8000-000000000000");
    expect(normalizeChatText("  hello  ")).toBe("hello");
    expect(normalizeChatText("   ")).toBeNull();
  });

  it("keeps reconnecting and degraded states on the legacy connecting status", () => {
    expect(legacyStatusForMeetingState("reconnecting")).toBe("connecting");
    expect(legacyStatusForMeetingState("degraded")).toBe("connecting");
    expect(legacyStatusForMeetingState("connected")).toBe("connected");
  });

  it("keeps desktop media fallbacks ordered from 720p to audio-only", () => {
    const profiles = buildMeetingMediaProfiles(true, false);
    expect(profiles).toHaveLength(5);
    expect(profiles[0].video).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
    expect(profiles.at(-1)?.video).toBe(false);
    expect(buildMeetingMediaProfiles(false, false)).toHaveLength(1);
  });

  it("updates participant maps immutably", () => {
    const original = new Map([[1, { userId: 1, name: "One" }]]);
    const added = addParticipantToMap(original, { userId: 2, name: "Two" });
    expect(added).not.toBe(original);
    expect(added.get(2)?.name).toBe("Two");
    const removed = removeParticipantFromMap(added, 1);
    expect(removed.has(1)).toBe(false);
    expect(original.has(1)).toBe(true);
  });

  it("builds moderation payloads without changing protocol fields", () => {
    expect(buildRaiseHandPayload(7, true, "msg-1")).toEqual({
      meetingId: 7,
      raised: true,
      clientMsgId: "msg-1",
    });
    expect(buildMuteParticipantPayload("m", 9, false, "msg-2")).toEqual({
      meetingId: "m",
      targetUserId: 9,
      muted: false,
      clientMsgId: "msg-2",
    });
  });

  it("clears every peer recovery timer", () => {
    vi.useFakeTimers();
    const peer = {
      _disconnectTimer: setTimeout(() => undefined, 10),
      _relayRetryTimer: setTimeout(() => undefined, 10),
      _connectTimeoutTimer: setTimeout(() => undefined, 10),
    };
    clearPeerRecoveryTimers(peer);
    expect(peer).toEqual({
      _disconnectTimer: null,
      _relayRetryTimer: null,
      _connectTimeoutTimer: null,
    });
    vi.useRealTimers();
  });

  it("stops all screen-share tracks", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    stopScreenStream({
      getTracks: () => [{ stop: stopA }, { stop: stopB }],
    } as unknown as MediaStream);
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopB).toHaveBeenCalledOnce();
  });

  it("preserves TURN detection, filtering, and bounded signaling queue behavior", () => {
    const configured = [
      { urls: "turn:relay.example.test", username: "u", credential: "p" },
    ];
    expect(hasRealTurn({ iceServers: configured, mode: "static" })).toBe(true);
    expect(hasRealTurn({ iceServers: configured, mode: "stun-only" })).toBe(
      true,
    );
    expect(
      applyPublicTurnPolicy(
        [{ urls: ["stun:a", "turn:openrelay.metered.ca:443"] }],
        false,
      ),
    ).toEqual([{ urls: "stun:a" }]);
    const queue = [{ type: "old" }];
    queueSignalingFrame(queue, { type: "new" }, 1);
    expect(queue).toEqual([{ type: "new" }]);
  });

  it("keeps bitrate tiers and bounded presenter/speaker priority", () => {
    expect([1, 4, 7].map(videoBitrateForPeerCount)).toEqual([
      500_000, 300_000, 150_000,
    ]);
    expect(
      selectPriorityVideoPeers({
        participantIds: [1, 2, 3, 4, 5],
        localUserId: 1,
        presenterId: 2,
        activeSpeakerId: 3,
        recentSpeakers: new Map([
          [4, 20],
          [5, 10],
        ]),
        maxPeers: 3,
      }),
    ).toEqual(new Set([2, 3, 4]));
  });
});
