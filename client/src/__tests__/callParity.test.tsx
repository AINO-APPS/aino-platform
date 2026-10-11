import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCallActions from "../pages/chat/useCallActions";
import useChatPageExtras from "../pages/chat/useChatPageExtras";
import useCallControls from "../components/chat/call/useCallControls";
import { findVideoSender } from "../components/chat/call/videoSender";
import useWebRTC from "../components/chat/call/useWebRTC";

const createMeeting = vi.hoisted(() => vi.fn());
vi.mock("../api/meetings", () => ({ createMeeting }));
vi.mock("../api/chat", () => ({
  createConversation: vi.fn(),
  getIceConfig: vi.fn().mockResolvedValue({
    data: { iceServers: [{ urls: "turn:relay.example.test", username: "test", credential: "test" }] },
  }),
}));

function track(kind: string) {
  const t = { kind, id: `${kind}-${Math.random()}`, enabled: true, readyState: "live", stop: vi.fn() };
  t.stop.mockImplementation(() => { t.readyState = "ended"; });
  return t;
}
function stream(...initial: ReturnType<typeof track>[]) {
  let tracks = [...initial];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    addTrack: (t: ReturnType<typeof track>) => { tracks.push(t); },
    removeTrack: (t: ReturnType<typeof track>) => { tracks = tracks.filter((x) => x !== t); },
  } as unknown as MediaStream;
}
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  getUserMedia = vi.fn().mockResolvedValue(stream(track("audio")));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
  });
  createMeeting.mockReset().mockResolvedValue({ data: {} });
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const alice = { id: 9, other_full_name: "Alice", is_group: false };
const bob = { id: 10, other_full_name: "Bob", is_group: false };
function actionsSetup() {
  const wsSend = vi.fn();
  const openConversation = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ conversation, userId = 1, tenantId = 1 }) => {
    const [callState, setCallState] = useState<any>(null);
    const state = {
      activeConv: conversation, callState, setCallState, wsSend,
      user: { id: userId, tenant_id: tenantId }, callSignalRef: { current: null }, callEndRef: { current: null },
      openConversation,
    };
    const actions = useCallActions(state as any);
    const extras = useChatPageExtras(state, actions);
    return { ...actions, extras, callState, setCallState };
  }, { initialProps: { conversation: alice, userId: 1, tenantId: 1 } });
  return { ...hook, wsSend, openConversation };
}

describe("outgoing call confirmation", () => {
  it.each(["voice", "video"] as const)("defers %s media/signaling until confirmation and captures the target", async (type) => {
    const { result, rerender, wsSend } = actionsSetup();
    act(() => { (type === "voice" ? result.current.handleVoiceCall : result.current.handleVideoCall)(); });
    expect(result.current.pendingCall?.conversation.id).toBe(alice.id);
    expect(wsSend).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.callState).toBeNull();
    rerender({ conversation: bob, userId: 1, tenantId: 1 });
    await act(async () => { result.current.confirmPendingCall(); result.current.confirmPendingCall(); });
    expect(wsSend).toHaveBeenCalledExactlyOnceWith("call_initiate", { conversationId: alice.id, callType: type });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia.mock.calls[0][0].video === false).toBe(type === "voice");
    expect(result.current.callState.callType).toBe(type);
  });

  it("cancel has no call side effects", () => {
    const { result, wsSend } = actionsSetup();
    act(() => { result.current.handleVoiceCall(); result.current.cancelPendingCall(); result.current.confirmPendingCall(); });
    expect(result.current.pendingCall).toBeNull();
    expect(wsSend).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createMeeting).not.toHaveBeenCalled();
  });

  it.each(["user", "tenant"])("cancels pending confirmation when the %s changes", (scope) => {
    const { result, rerender, wsSend } = actionsSetup();
    act(() => result.current.handleVideoCall());
    rerender({ conversation: alice, userId: scope === "user" ? 2 : 1, tenantId: scope === "tenant" ? 2 : 1 });
    expect(result.current.pendingCall).toBeNull();
    act(() => result.current.confirmPendingCall());
    expect(wsSend).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("captures chat-list/history targets before conversation navigation completes", async () => {
    const { result, wsSend, rerender } = actionsSetup();
    await act(async () => { await result.current.extras.callFrom(bob, "video"); });
    rerender({ conversation: alice, userId: 1, tenantId: 1 });
    expect(result.current.pendingCall?.conversation.id).toBe(bob.id);
    expect(wsSend).not.toHaveBeenCalled();
    await act(async () => { result.current.confirmPendingCall(); });
    expect(wsSend).toHaveBeenCalledWith("call_initiate", { conversationId: bob.id, callType: "video" });
  });

  it("creates a group huddle only after confirmation using the captured group", async () => {
    const { result, wsSend } = actionsSetup();
    const group = { id: 12, is_group: true, group_name: "Team" };
    act(() => result.current.requestCall("voice", group));
    expect(createMeeting).not.toHaveBeenCalled();
    await act(async () => { result.current.confirmPendingCall(); });
    expect(createMeeting).toHaveBeenCalledExactlyOnceWith({
      title: "Team", conversation_id: 12, huddle: true,
      settings: { allowScreenShare: true, callType: "voice" },
    });
    expect(wsSend).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("stops outgoing capture resolved after hang-up", async () => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const { result } = actionsSetup();
    act(() => result.current.handleVoiceCall());
    act(() => result.current.confirmPendingCall());
    act(() => result.current.handleEndCall());
    const audio = track("audio");
    await act(async () => { resolve(stream(audio)); });
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(result.current.callState).toBeNull();
  });

  it("a late permission failure cannot cancel a replacement call", async () => {
    let reject!: (error: Error) => void;
    getUserMedia.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; }));
    const { result, wsSend } = actionsSetup();
    act(() => result.current.handleVoiceCall());
    act(() => result.current.confirmPendingCall());
    act(() => result.current.handleEndCall());
    act(() => result.current.handleVideoCall());
    await act(async () => { result.current.confirmPendingCall(); });
    const replacement = result.current.callState;
    await act(async () => { reject(new Error("late permission failure")); });
    expect(wsSend).not.toHaveBeenCalledWith("call_cancel", expect.anything());
    expect(result.current.callState).toBe(replacement);
  });
});

function controlsSetup(initial = stream(track("audio")), transceivers: any[] = []) {
  const audioSender = { track: null, replaceTrack: vi.fn().mockResolvedValue(undefined) };
  const pc = {
    signalingState: "stable",
    getTransceivers: () => transceivers,
    getSenders: () => [audioSender, ...transceivers.map((t) => t.sender)],
    addTrack: vi.fn((t: MediaStreamTrack) => ({
      track: t,
      replaceTrack: vi.fn().mockResolvedValue(undefined),
    })),
  };
  const refs = {
    localStreamRef: { current: initial as MediaStream | null },
    pcRef: { current: pc as unknown as RTCPeerConnection | null },
    screenStreamRef: { current: null as MediaStream | null },
    screenSenderRef: { current: null as RTCRtpSender | null },
    localVideoRef: { current: null },
    remoteVideoRef: { current: null },
    overlayRef: { current: null },
  };
  const hook = renderHook(() => useCallControls(refs));
  return { ...hook, refs, pc, audioSender };
}
describe("independent camera", () => {
  it("upgrades voice calls, releases capture on off, and never touches the audio sender", async () => {
    const sender: any = { track: null, replaceTrack: vi.fn().mockResolvedValue(undefined) };
    const transceiver = { sender, receiver: { track: { kind: "video" } }, direction: "recvonly" };
    const { result, refs, audioSender } = controlsSetup(undefined, [transceiver]);
    const camera = track("video");
    getUserMedia.mockResolvedValue(stream(camera));
    expect(result.current.videoOff).toBe(true);
    await act(async () => { await result.current.toggleVideo(); });
    expect(result.current.videoOff).toBe(false);
    expect(transceiver.direction).toBe("sendrecv");
    expect(sender.replaceTrack).toHaveBeenCalledWith(camera);
    expect(audioSender.replaceTrack).not.toHaveBeenCalled();
    sender.track = camera;
    const audio = refs.localStreamRef.current!.getAudioTracks()[0];
    await act(async () => { await result.current.toggleVideo(); });
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(audio.enabled).toBe(true);
    expect(result.current.videoOff).toBe(true);
    getUserMedia.mockResolvedValue(stream(track("video")));
    await act(async () => { await result.current.toggleVideo(); });
    expect(result.current.videoOff).toBe(false);
    expect(audioSender.replaceTrack).not.toHaveBeenCalled();
  });

  it("adds a video sender for an audio-only connection", async () => {
    const { result, pc, audioSender } = controlsSetup();
    const camera = track("video");
    getUserMedia.mockResolvedValue(stream(camera));
    await act(async () => { await result.current.toggleVideo(); });
    expect(pc.addTrack).toHaveBeenCalledWith(camera, expect.anything());
    expect(audioSender.replaceTrack).not.toHaveBeenCalled();
    expect(result.current.videoOff).toBe(false);
  });

  it("leaves audio intact on camera permission or sender failure", async () => {
    const { result, refs, pc } = controlsSetup();
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await act(async () => { await result.current.toggleVideo(); });
    expect(result.current.cameraError).toMatch(/audio call is still connected/);
    expect(result.current.videoOff).toBe(true);
    expect(refs.localStreamRef.current!.getAudioTracks()[0].enabled).toBe(true);
    const camera = track("video");
    getUserMedia.mockResolvedValue(stream(camera));
    pc.addTrack.mockImplementationOnce(() => { throw new Error("sender failed"); });
    await act(async () => { await result.current.toggleVideo(); });
    expect(camera.stop).toHaveBeenCalled();
    expect(result.current.videoOff).toBe(true);
  });

  it.each(["hangup", "unmount"])("discards camera capture resolving after %s", async (end) => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const { result, refs, unmount, pc } = controlsSetup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.toggleVideo(); });
    if (end === "hangup") { refs.localStreamRef.current = null; refs.pcRef.current = null; }
    else unmount();
    const camera = track("video");
    await act(async () => { resolve(stream(camera)); await pending; });
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(pc.addTrack).not.toHaveBeenCalled();
  });

  it("camera toggles do not replace or stop an active screen share", async () => {
    const { result, refs } = controlsSetup();
    const screenTrack = track("video");
    const screenSender = { track: screenTrack, replaceTrack: vi.fn() };
    refs.screenStreamRef.current = stream(screenTrack);
    refs.screenSenderRef.current = screenSender as any;
    const camera = track("video");
    getUserMedia.mockResolvedValue(stream(camera));
    await act(async () => { await result.current.toggleVideo(); });
    await act(async () => { await result.current.toggleVideo(); });
    expect(screenSender.replaceTrack).not.toHaveBeenCalled();
    expect(screenTrack.stop).not.toHaveBeenCalled();
    expect(camera.stop).toHaveBeenCalled();
  });

  it("stopping a share restores the camera enabled during that share", async () => {
    const { result, refs } = controlsSetup();
    const screenTrack = track("video");
    (navigator.mediaDevices as any).getDisplayMedia = vi.fn().mockResolvedValue(stream(screenTrack));
    await act(async () => { await result.current.toggleScreenShare(); });
    const sender = refs.screenSenderRef.current!;
    const camera = track("video");
    getUserMedia.mockResolvedValue(stream(camera));
    await act(async () => { await result.current.toggleVideo(); });
    expect(result.current.screenSharing).toBe(true);
    await act(async () => { await result.current.toggleScreenShare(); });
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(camera);
    expect(screenTrack.stop).toHaveBeenCalledOnce();
    expect(camera.stop).not.toHaveBeenCalled();
    expect(result.current.videoOff).toBe(false);
  });

  it("coalesces camera acquisition and honors hold entered while permission is pending", async () => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const { result } = controlsSetup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.toggleVideo(); });
    await act(async () => { await result.current.toggleVideo(); result.current.toggleHold(); });
    expect(getUserMedia).toHaveBeenCalledOnce();
    const camera = track("video");
    await act(async () => { resolve(stream(camera)); await pending; });
    expect(camera.enabled).toBe(false);
    expect(result.current.videoOff).toBe(true);
    act(() => result.current.toggleHold());
    expect(camera.enabled).toBe(true);
    expect(result.current.videoOff).toBe(false);
  });

  it("hold/resume preserves camera-off and prior muted state", async () => {
    const audio = track("audio");
    audio.enabled = false;
    const { result } = controlsSetup(stream(audio));
    act(() => result.current.toggleHold());
    act(() => result.current.toggleHold());
    expect(result.current.videoOff).toBe(true);
    expect(result.current.muted).toBe(true);
    expect(audio.enabled).toBe(false);
    await act(async () => {});
  });

  it("video sender selection never guesses an empty audio sender", () => {
    const audioSender = { track: null };
    expect(findVideoSender({
      getTransceivers: () => [{ sender: audioSender, receiver: { track: { kind: "audio" } } }],
      getSenders: () => [audioSender],
    } as any)).toBeUndefined();
  });
});

async function rtcSetup() {
  const pc: any = {
    signalingState: "stable", connectionState: "new",
    getSenders: () => [], getReceivers: () => [], getTransceivers: () => [],
    addTrack: vi.fn(),
    createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "offer" }),
    createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "answer" }),
    setLocalDescription: vi.fn(async (d: any) => {
      pc.localDescription = d;
      pc.signalingState = d.type === "offer" ? "have-local-offer" : "stable";
    }),
    setRemoteDescription: vi.fn(async (d: any) => { pc.remoteDescription = d; pc.signalingState = "stable"; }),
    close: vi.fn(), addIceCandidate: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("RTCPeerConnection", function () { return pc; });
  vi.stubGlobal("RTCSessionDescription", function (this: any, d: any) { Object.assign(this, d); });
  vi.stubGlobal("MediaStream", function () { return stream(); });
  const local = stream(track("audio"));
  const onSignal = { current: null as any };
  const wsSend = vi.fn();
  const hook = renderHook(() => useWebRTC({
    callType: "voice",
    callState: {
      callId: 2, conversationId: 9, isIncoming: false, callerId: 1,
      accepted: true, acceptedBy: 3, localStream: local, onSignal,
      onEndExternal: { current: null },
    },
    wsSend, onEnd: vi.fn(), onStatusChange: vi.fn(),
  }));
  await waitFor(() => expect(hook.result.current.pcRef.current).toBe(pc));
  await waitFor(() => expect(pc.setLocalDescription).toHaveBeenCalled());
  return { ...hook, local, onSignal, wsSend, pc };
}
describe("voice camera signaling and negotiation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])("honors camera-off=%s announced before the remote track arrives", async (off) => {
    const { result, pc, local, onSignal, unmount } = await rtcSetup();
    await act(async () => { await onSignal.current({ type: "video-state", videoOff: off }, 3); });
    const camera: any = track("video");
    act(() => { pc.ontrack({ track: camera, streams: [stream(camera)] }); });
    act(() => camera.onunmute());
    expect(result.current.remoteHasVideo).toBe(true);
    expect(result.current.remoteVideoOff).toBe(off);
    expect(local.getVideoTracks()).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();
    unmount();
  });

  it("restores retained remote camera tracks without enabling the local camera", async () => {
    const { result, pc, local, onSignal, wsSend, unmount } = await rtcSetup();
    const camera = track("video");
    const remote = stream(camera);
    act(() => { pc.ontrack({ track: camera, streams: [remote] }); });
    expect(result.current.remoteHasVideo).toBe(true);
    await act(async () => { await onSignal.current({ type: "video-state", videoOff: true }, 3); });
    expect(result.current.remoteVideoOff).toBe(true);
    expect(remote.getVideoTracks()).toEqual([camera]);
    await act(async () => { await onSignal.current({ type: "video-state", videoOff: false }, 3); });
    expect(result.current.remoteVideoOff).toBe(false);
    expect(local.getVideoTracks()).toHaveLength(0);
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => { await onSignal.current({ type: "request-video-state" }, 3); });
    expect(wsSend).toHaveBeenLastCalledWith("call_signal", expect.objectContaining({
      signal: { type: "video-state", videoOff: true },
    }));
    const ownCamera = track("video");
    local.addTrack(ownCamera as any);
    await act(async () => { await onSignal.current({ type: "request-video-state" }, 3); });
    expect(wsSend).toHaveBeenLastCalledWith("call_signal", expect.objectContaining({
      signal: { type: "video-state", videoOff: false },
    }));
    ownCamera.enabled = false;
    await act(async () => { await onSignal.current({ type: "request-video-state" }, 3); });
    expect(wsSend).toHaveBeenLastCalledWith("call_signal", expect.objectContaining({
      signal: { type: "video-state", videoOff: true },
    }));
    result.current.screenStreamRef.current = stream(track("video"));
    await act(async () => { await onSignal.current({ type: "request-video-state" }, 3); });
    expect(wsSend).toHaveBeenLastCalledWith("call_signal", expect.objectContaining({
      signal: { type: "video-state", videoOff: false },
    }));
    unmount();
  });

  it("queues mid-call video negotiation until signaling is stable", async () => {
    const { pc, unmount } = await rtcSetup();
    pc.connectionState = "connected";
    act(() => pc.onconnectionstatechange());
    await act(async () => { await pc.onnegotiationneeded(); });
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
    pc.signalingState = "stable";
    await act(async () => { pc.onsignalingstatechange(); });
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    expect(pc.signalingState).toBe("have-local-offer");
    await act(async () => { await pc.onnegotiationneeded(); });
    expect(pc.createOffer).toHaveBeenCalledTimes(2);
    pc.signalingState = "stable";
    await act(async () => { pc.onsignalingstatechange(); });
    expect(pc.createOffer).toHaveBeenCalledTimes(3);
    unmount();
  });
});
