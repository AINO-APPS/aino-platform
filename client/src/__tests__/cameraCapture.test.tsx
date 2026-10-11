import { StrictMode, createRef } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CameraCapture from "../components/chat/CameraCapture";
import { cameraControls, MAX_CAMERA_BYTES, MAX_CAMERA_VIDEO_MS, recordingMimeType, validCameraVideo, zoomPresets } from "../components/chat/cameraCapabilities";
import { useCameraCapture } from "../components/chat/useCameraCapture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Track extends EventTarget {
  kind: string;
  readyState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  applyConstraints = vi.fn().mockResolvedValue(undefined);
  getCapabilities = vi.fn(() => ({}));
  getSettings = vi.fn(() => ({ deviceId: "back" }));
  constructor(kind: string) { super(); this.kind = kind; }
}
class Stream {
  constructor(public tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
}
class Recorder {
  static isTypeSupported = vi.fn((type: string) => type.startsWith("video/webm"));
  static instances: Recorder[] = [];
  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; });
  constructor(public stream: Stream, options: { mimeType: string }) { this.mimeType = options.mimeType; Recorder.instances.push(this); }
  data(size = 32) { this.ondataavailable?.({ data: new Blob([new Uint8Array(size)], { type: this.mimeType }) }); }
  complete() { this.state = "inactive"; this.onstop?.(); }
}

let video: Track;
let audio: Track;
let gum: ReturnType<typeof vi.fn>;
let enumerate: ReturnType<typeof vi.fn>;
let capture: ReturnType<typeof vi.fn<(file: File) => void>>;
let close: ReturnType<typeof vi.fn<() => void>>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function setupHook() {
  const element = document.createElement("video");
  const ref = createRef<HTMLVideoElement>(); ref.current = element;
  return renderHook(() => useCameraCapture(ref, capture, close));
}
function showCamera() { return render(<CameraCapture onCapture={capture} onClose={close} onGallery={vi.fn()} />); }

beforeEach(() => {
  video = new Track("video"); audio = new Track("audio");
  gum = vi.fn(async (constraints: MediaStreamConstraints) => new Stream([constraints.audio ? audio : video]));
  enumerate = vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "back", label: "Back camera" }]);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: gum, enumerateDevices: enumerate } });
  vi.stubGlobal("MediaStream", Stream); vi.stubGlobal("MediaRecorder", Recorder);
  Recorder.instances = []; Recorder.isTypeSupported.mockImplementation((type: string) => type.startsWith("video/webm"));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["photo"], { type: "image/jpeg" })));
  capture = vi.fn(); close = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("camera capabilities and limits", () => {
  test("selects only supported recording types and filters zoom presets", () => {
    Recorder.isTypeSupported.mockImplementation((type) => type === "video/mp4");
    expect(recordingMimeType()).toBe("video/mp4");
    expect(zoomPresets(1, 3)).toEqual([1, 2]);
    expect(cameraControls(video as unknown as MediaStreamTrack)).toEqual({ torch: false, zoom: undefined });
    vi.stubGlobal("MediaRecorder", undefined);
    expect(recordingMimeType()).toBeNull();
    expect(validCameraVideo(new Blob(["x"]), 60_000)).toBe(true);
    expect(validCameraVideo(new Blob(["x"]), 60_001)).toBe(false);
    expect(validCameraVideo(new Blob([]), 100)).toBe(false);
  });
  test("hides unsupported controls and keeps photos working without MediaRecorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    showCamera(); await flush();
    expect(screen.getByRole("button", { name: "Video" })).toBeDisabled();
    expect(screen.queryByLabelText("Switch camera")).toBeNull();
    expect(screen.queryByLabelText("Camera zoom")).toBeNull();
    expect(screen.queryByLabelText("Camera light")).toBeNull();
    fireEvent.click(screen.getByLabelText("Capture photo"));
    expect(capture.mock.calls[0][0].type).toBe("image/jpeg");
    expect(gum).toHaveBeenCalledTimes(1);
    expect(video.stop).toHaveBeenCalled();
  });
  test("discovers real switch, zoom and torch controls", async () => {
    video.getCapabilities.mockReturnValue({ zoom: { min: 1, max: 3, step: .1 }, torch: true });
    enumerate.mockResolvedValue([{ kind: "videoinput", deviceId: "back", label: "Back" }, { kind: "videoinput", deviceId: "front", label: "Front" }]);
    showCamera(); await flush();
    fireEvent.click(screen.getByLabelText("Camera light")); await flush();
    expect(video.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    fireEvent.change(screen.getByLabelText("Camera zoom"), { target: { value: "2" } }); await flush();
    expect(video.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    expect(screen.getByRole("button", { name: "2×" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "5×" })).toBeNull();
    const next = new Track("video"); gum.mockResolvedValueOnce(new Stream([next]));
    fireEvent.change(screen.getByLabelText("Switch camera"), { target: { value: "front" } }); await flush();
    expect(gum).toHaveBeenLastCalledWith({ video: { deviceId: { exact: "front" } }, audio: false });
    expect(video.stop).toHaveBeenCalled();
  });
});

describe("startup and lifecycle races", () => {
  test("close during startup disposes late camera tracks without attaching", async () => {
    const pending = deferred<Stream>(); gum.mockReturnValueOnce(pending.promise);
    const hook = setupHook();
    act(() => hook.result.current.close());
    pending.resolve(new Stream([video])); await flush();
    expect(video.stop).toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });
  test("StrictMode discards its first startup and uses only the latest stream", async () => {
    const first = deferred<Stream>(); const stale = new Track("video");
    gum.mockReturnValueOnce(first.promise);
    const element = document.createElement("video"); const ref = createRef<HTMLVideoElement>(); ref.current = element;
    const hook = renderHook(() => useCameraCapture(ref, capture, close), { wrapper: StrictMode }); await flush();
    first.resolve(new Stream([stale])); await flush();
    expect(stale.stop).toHaveBeenCalled(); expect(video.stop).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("ready");
    hook.unmount(); expect(video.stop).toHaveBeenCalled();
  });
  test("camera rejection is retryable and missing API can still close", async () => {
    gum.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    showCamera(); await flush(); expect(screen.getByRole("alert")).toHaveTextContent("blocked");
    expect(screen.getByLabelText("Capture photo")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Photo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Video" })).toBeDisabled();
    expect(screen.getByLabelText("Open gallery")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); await flush();
    expect(gum).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Capture photo")).toBeEnabled();
  });
  test("stale camera switching response stops its own stream only", async () => {
    const pending = deferred<Stream>(); const stale = new Track("video"); const latest = new Track("video");
    const hook = setupHook(); await flush();
    gum.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(new Stream([latest]));
    act(() => { void hook.result.current.startCamera("front"); void hook.result.current.startCamera("back"); }); await flush();
    pending.resolve(new Stream([stale])); await flush();
    expect(stale.stop).toHaveBeenCalled(); expect(latest.stop).not.toHaveBeenCalled();
  });
  test("close during photo encoding prevents delivery", async () => {
    let encode!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => { encode = callback; });
    const hook = setupHook(); await flush();
    act(() => { hook.result.current.takePhoto(); hook.result.current.takePhoto(); hook.result.current.close(); });
    act(() => encode(new Blob(["photo"])));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });
  test("background and device termination discard recording", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const recorder = Recorder.instances[0]; recorder.data();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    recorder.complete();
    expect(capture).not.toHaveBeenCalled(); expect(audio.stop).toHaveBeenCalled(); expect(video.stop).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  test("video track ending or unmount cleans recorder handlers and streams", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const recorder = Recorder.instances[0];
    act(() => video.dispatchEvent(new Event("ended")));
    expect(recorder.onstop).toBeNull(); expect(audio.stop).toHaveBeenCalled();
    expect(hook.result.current.error).toContain("disconnected");
    hook.unmount(); expect(capture).not.toHaveBeenCalled();
  });
});

describe("recording permission and finalization", () => {
  test("duplicate starts issue one microphone request; release during permission discards late audio", async () => {
    const pending = deferred<Stream>(); const hook = setupHook(); await flush();
    gum.mockReturnValueOnce(pending.promise);
    act(() => { void hook.result.current.startRecording(); void hook.result.current.startRecording(); hook.result.current.finish(); void hook.result.current.startRecording(); });
    expect(gum).toHaveBeenCalledTimes(2);
    pending.resolve(new Stream([audio])); await flush();
    expect(audio.stop).toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0); expect(capture).not.toHaveBeenCalled();
  });
  test("microphone denial requires explicit silent acceptance and never repeats prompts", async () => {
    const hook = setupHook(); await flush(); gum.mockRejectedValueOnce(new Error("denied"));
    await act(async () => hook.result.current.startRecording());
    expect(hook.result.current.needsSilent).toBe(true); expect(Recorder.instances).toHaveLength(0);
    await act(async () => hook.result.current.startRecording()); expect(gum).toHaveBeenCalledTimes(2);
    await act(async () => hook.result.current.startRecording(true));
    expect(hook.result.current.silent).toBe(true); expect(Recorder.instances[0].stream.getAudioTracks()).toHaveLength(0);
    act(() => hook.result.current.cancel()); await act(async () => hook.result.current.startRecording());
    expect(gum).toHaveBeenCalledTimes(2); expect(Recorder.instances).toHaveLength(2);
  });
  test("Video tap starts/stops and sends a supported File only after finalization", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "performance"] });
    showCamera(); await flush(); fireEvent.click(screen.getByRole("button", { name: "Video" }));
    fireEvent.click(screen.getByLabelText("Start recording")); await flush();
    const recorder = Recorder.instances[0]; expect(recorder.start).toHaveBeenCalledWith(250);
    expect(recorder.stream.getAudioTracks()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getByLabelText("Recording duration")).toHaveTextContent("00:01");
    fireEvent.click(screen.getByLabelText("Stop recording")); expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled(); expect(screen.getByLabelText("Start recording")).toBeDisabled();
    act(() => { recorder.data(); recorder.complete(); });
    expect(capture).toHaveBeenCalledTimes(1); expect(capture.mock.calls[0][0]).toBeInstanceOf(File);
    expect(capture.mock.calls[0][0].type).toMatch(/^video\/webm/); expect(audio.stop).toHaveBeenCalled(); expect(video.stop).toHaveBeenCalled();
  });
  test("duration timer stops at the bound and validates the final bytes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "performance"] });
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const recorder = Recorder.instances[0];
    act(() => vi.advanceTimersByTime(MAX_CAMERA_VIDEO_MS - 251));
    expect(recorder.stop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    act(() => { recorder.data(); recorder.complete(); }); expect(capture).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  test("oversized chunks and final empty videos are discarded", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const recorder = Recorder.instances[0];
    act(() => recorder.data(MAX_CAMERA_BYTES + 1));
    expect(recorder.stop).toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(hook.result.current.error).toContain("25 MiB");
    audio.readyState = "live";
    await act(async () => hook.result.current.startRecording());
    act(() => { hook.result.current.finish(); Recorder.instances[1].complete(); });
    expect(capture).not.toHaveBeenCalled(); expect(hook.result.current.error).toContain("non-empty");
  });
  test("delayed auto-stop beyond 60 seconds is discarded, not clamped into a valid duration", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const start = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(start + 60_001);
    act(() => { hook.result.current.finish(); Recorder.instances[0].data(); Recorder.instances[0].complete(); });
    expect(capture).not.toHaveBeenCalled(); expect(hook.result.current.error).toContain("60 seconds");
  });
  test("exact byte limit stops capture and accepts a valid final video", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    const start = performance.now(); vi.spyOn(performance, "now").mockReturnValue(start + 1000);
    const recorder = Recorder.instances[0]; act(() => recorder.data(MAX_CAMERA_BYTES));
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    act(() => recorder.complete());
    expect(capture.mock.calls[0][0].size).toBe(MAX_CAMERA_BYTES);
  });
  test("microphone track termination discards a live recording", async () => {
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    act(() => audio.dispatchEvent(new Event("ended")));
    expect(capture).not.toHaveBeenCalled(); expect(Recorder.instances[0].onstop).toBeNull();
    expect(hook.result.current.error).toContain("Microphone disconnected");
  });
  test("MediaRecorder startup failure releases audio and restores photos", async () => {
    const BadRecorder = class extends Recorder { start = vi.fn(() => { throw new Error("unsupported"); }); };
    vi.stubGlobal("MediaRecorder", BadRecorder);
    const hook = setupHook(); await flush(); await act(async () => hook.result.current.startRecording());
    expect(audio.stop).toHaveBeenCalled(); expect(hook.result.current.phase).toBe("ready");
    act(() => hook.result.current.takePhoto()); expect(capture.mock.calls[0][0].type).toBe("image/jpeg");
  });
});

describe("photo hold and keyboard shutter", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "performance"] }));
  test("tap is photo; 400ms hold starts quick video and release finishes", async () => {
    showCamera(); await flush(); const button = screen.getByLabelText("Capture photo");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(399)); expect(Recorder.instances).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1)); await flush(); expect(Recorder.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200)); fireEvent.pointerUp(button, { pointerId: 1 });
    expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1);
    act(() => { Recorder.instances[0].data(); Recorder.instances[0].complete(); });
    expect(capture).toHaveBeenCalledTimes(1); expect(capture.mock.calls[0][0].type).toMatch(/^video\//);
  });
  test("short pointer release captures one photo, not its following click", async () => {
    showCamera(); await flush(); const button = screen.getByLabelText("Capture photo");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 }); act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(button, { pointerId: 1 }); fireEvent.click(button);
    expect(capture).toHaveBeenCalledTimes(1); expect(Recorder.instances).toHaveLength(0);
  });
  test("pointer cancellation during hold discards instead of sending", async () => {
    showCamera(); await flush(); const button = screen.getByLabelText("Capture photo");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 }); act(() => vi.advanceTimersByTime(400)); await flush();
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(Recorder.instances[0].stop).toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(70_000)); expect(capture).not.toHaveBeenCalled();
  });
  test("keyboard tap takes photo and focus stays trapped until Escape", async () => {
    showCamera(); await flush(); const button = screen.getByLabelText("Capture photo"); button.focus();
    fireEvent.keyDown(button, { key: "Tab" }); expect(screen.getByLabelText("Close camera")).toHaveFocus();
    fireEvent.keyDown(button, { key: " " }); act(() => vi.advanceTimersByTime(100)); fireEvent.keyUp(button, { key: " " });
    expect(capture).toHaveBeenCalledTimes(1);
  });
  test("silent recording option is explicit and visibly labelled", async () => {
    showCamera(); await flush(); gum.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Video" })); fireEvent.click(screen.getByLabelText("Start recording")); await flush();
    expect(Recorder.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Record without sound" })); await flush();
    expect(screen.getByText("Recording without sound")).toBeInTheDocument(); expect(gum).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Discard recording" })); expect(capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Start recording")); await flush(); expect(gum).toHaveBeenCalledTimes(2);
  });
  test("pinch changes only real zoom capabilities", async () => {
    video.getCapabilities.mockReturnValue({ zoom: { min: 1, max: 3, step: .1 } });
    showCamera(); await flush(); const stage = screen.getByLabelText("Live camera preview").parentElement!;
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerDown(stage, { pointerId: 2, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 200, clientY: 0 }); await flush();
    expect(video.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    fireEvent.pointerCancel(stage, { pointerId: 2 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 250, clientY: 0 });
    expect(video.applyConstraints).toHaveBeenCalledTimes(1);
  });
  test("keyboard hold requests mic once and Escape cancels pending permission", async () => {
    const pending = deferred<Stream>(); showCamera(); await flush(); gum.mockReturnValueOnce(pending.promise);
    const button = screen.getByLabelText("Capture photo");
    fireEvent.keyDown(button, { key: "Enter" }); fireEvent.keyDown(button, { key: "Enter", repeat: true });
    act(() => vi.advanceTimersByTime(400)); fireEvent.keyDown(button, { key: "Escape" });
    pending.resolve(new Stream([audio])); await flush();
    expect(gum).toHaveBeenCalledTimes(2); expect(audio.stop).toHaveBeenCalled(); expect(Recorder.instances).toHaveLength(0);
  });
});
