import { describe, expect, it } from "vitest";
import { applyPublicTurnPolicy, hasRealTurn } from "../components/chat/call/iceConfig";
import { buildMediaConstraintProfiles } from "../components/chat/call/mediaConstraints";

describe("call transport boundaries", () => {
  it("removes only public TURN when deployment policy disables it", () => {
    const servers: RTCIceServer[] = [
      { urls: ["stun:example.test", "turn:openrelay.metered.ca:443"] },
      { urls: "turn:managed.example.test", username: "u", credential: "p" },
    ];
    expect(applyPublicTurnPolicy(servers, false)).toEqual([
      { urls: "stun:example.test" },
      { urls: "turn:managed.example.test", username: "u", credential: "p" },
    ]);
    expect(applyPublicTurnPolicy(servers, true)).toBe(servers);
  });

  it("recognizes authoritative and legacy managed TURN configurations", () => {
    expect(hasRealTurn({ mode: "cloudflare-calls", iceServers: [] })).toBe(true);
    expect(hasRealTurn({ iceServers: [{ urls: "turns:corp.example.test" }] })).toBe(true);
    expect(hasRealTurn({ iceServers: [{ urls: "turn:openrelay.metered.ca:80" }] })).toBe(false);
  });

  it("keeps media acquisition fallbacks ordered by capability", () => {
    const desktop = buildMediaConstraintProfiles(true, false);
    expect(desktop).toHaveLength(5);
    expect(desktop[0].video).toMatchObject({ width: { ideal: 1280 } });
    expect(desktop.at(-1)).toEqual({ audio: expect.anything(), video: false });
    expect(buildMediaConstraintProfiles(false, false)).toHaveLength(2);
  });
});