import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rtc: {} as any, controls: {} as any, status: null as any,
}));
vi.mock("../components/chat/call/useWebRTC", () => ({
  default: ({ onStatusChange }: any) => { state.status = onStatusChange; return state.rtc; },
}));
vi.mock("../components/chat/call/useCallControls", () => ({ default: () => state.controls }));
vi.mock("../components/chat", () => ({ ChatAvatar: ({ name }: any) => <span>{name}</span> }));
vi.mock("../NotificationPrefsContext", () => ({
  useNotificationPrefs: () => ({ playRingtone: vi.fn(), playOutgoing: vi.fn() }),
}));
import CallOverlay from "../components/chat/call";

beforeEach(() => {
  const ref = () => ({ current: null });
  state.rtc = {
    remoteHasVideo: false, remoteVideoOff: true, remoteScreenSharing: false,
    localMediaStream: null,
    localStreamRef: ref(), pcRef: ref(), screenStreamRef: ref(), screenSenderRef: ref(),
    localVideoRef: ref(), remoteVideoRef: ref(), remoteAudioRef: ref(),
    remoteStreamRef: ref(), qualityControllerRef: ref(), connectionTimeoutRef: ref(),
    handleEnd: vi.fn(), handleAccept: vi.fn(), handleReject: vi.fn(),
    sendLocalVideoState: vi.fn(), sendLocalMuteState: vi.fn(),
    sendLocalScreenShareState: vi.fn(),
  };
  state.controls = {
    videoOff: true, muted: false, screenSharing: false, onHold: false,
    toggleVideo: vi.fn(), toggleMute: vi.fn(), toggleScreenShare: vi.fn(),
    toggleHold: vi.fn(), togglePiP: vi.fn(), toggleFullscreen: vi.fn(),
    setStatsPanelOpen: vi.fn(), startQualityMonitor: vi.fn(),
    setShowAudioDevices: vi.fn(), setShowVideoDevices: vi.fn(),
    audioDevices: [], videoDevices: [],
  };
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function overlay(callType = "voice") {
  return <CallOverlay
    callState={{ callType, conversationId: 9, remoteName: "Alice", isIncoming: false }}
    user={{ id: 1, fullName: "You" }} wsSend={vi.fn()} onEnd={vi.fn()}
  />;
}
describe("live overlay camera presentation", () => {
  it("offers the camera button and keyboard shortcut on original voice calls", () => {
    const view = render(overlay());
    act(() => state.status("connected"));
    fireEvent.click(screen.getByTitle("Turn on camera (V)"));
    fireEvent.keyDown(document, { key: "v" });
    expect(state.controls.toggleVideo).toHaveBeenCalledTimes(2);
    expect(state.rtc.sendLocalVideoState).toHaveBeenLastCalledWith(true);
    state.controls.videoOff = false;
    view.rerender(overlay());
    expect(screen.getByTitle("Turn off camera (V)")).toBeInTheDocument();
    expect(state.rtc.sendLocalVideoState).toHaveBeenLastCalledWith(false);
    expect(state.rtc.localVideoRef.current).not.toBeNull();
  });

  it("peer camera/share changes render video but never enable the local camera", () => {
    const view = render(overlay());
    act(() => state.status("connected"));
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(1);
    state.rtc.remoteHasVideo = true;
    state.rtc.remoteVideoOff = false;
    view.rerender(overlay());
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(2);
    expect(state.controls.toggleVideo).not.toHaveBeenCalled();
    expect(screen.getByTitle("Turn on camera (V)")).toBeInTheDocument();
    state.rtc.remoteVideoOff = true;
    view.rerender(overlay());
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(1);
    state.rtc.remoteScreenSharing = true;
    view.rerender(overlay());
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(2);
    state.rtc.remoteScreenSharing = false;
    view.rerender(overlay());
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(1);
  });

  it("returns original video calls to audio presentation when both cameras stop", () => {
    const view = render(overlay("video"));
    act(() => state.status("connected"));
    expect(view.baseElement.querySelectorAll("video")).toHaveLength(1);
    expect(state.rtc.sendLocalVideoState).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("Your preview")).toBeInTheDocument();
  });

  it("keeps elapsed duration when audio/video layouts remount their clocks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const view = render(overlay());
    act(() => state.status("connected"));
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getAllByText("00:09").length).toBeGreaterThan(0);
    state.rtc.remoteHasVideo = true;
    state.rtc.remoteVideoOff = false;
    view.rerender(overlay());
    expect(screen.getAllByText("00:09").length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(4000));
    state.rtc.remoteVideoOff = true;
    view.rerender(overlay());
    expect(screen.getAllByText("00:13").length).toBeGreaterThan(0);
  });
});
