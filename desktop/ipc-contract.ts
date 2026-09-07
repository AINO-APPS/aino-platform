import type { IpcMainEvent, IpcMainInvokeEvent, IpcRendererEvent, WebContents } from "electron";

export type Unsubscribe = () => void;
export type ReleaseNotes = string | Array<{ note?: string } | string>;
export type UpdateInfoPayload = { version?: string; releaseNotes?: ReleaseNotes; percent?: number; transferred?: number; total?: number; bytesPerSecond?: number; message?: string };
export type UpdateCheckResult = { available: boolean; reason?: string; version?: string; error?: string };
export type LocationResult = { ok: boolean; latitude?: number; longitude?: number; accuracy?: number; error?: string };
export type WifiInfoResult = { ok: boolean; bssid?: string; ssid?: string | null; signal?: number | null; error?: string };
export type OperationResult = { ok: boolean; error?: string };
export type BiometricAvailability = { available: boolean; enrolled: boolean; platform: NodeJS.Platform };
export type BiometricLoginResult = OperationResult & { credentialId?: string; deviceSecret?: string };
export type BiometricEnrollment = { credentialId: string; deviceSecret: string };
export type ScreenSource = { id: string; name: string; thumbnail: string; appIcon: string | null };
export type WindowVisibility = { reason: string };
export type CallPipAction = "mute" | "unmute" | "restore" | "end";
export type CallPipState = { remoteName?: string; remoteAvatar?: string | null; status?: string; durationSec?: number; muted?: boolean; videoOff?: boolean; callType?: string };

/** Renderer requests for which main returns a result. */
export interface InvokeContract {
  "get-app-version": { args: []; result: string };
  "is-maximized": { args: []; result: boolean };
  "check-for-update": { args: []; result: UpdateCheckResult };
  "fetch-release-notes": { args: [version: string]; result: string };
  "get-ip-location": { args: []; result: LocationResult };
  "get-native-location": { args: []; result: LocationResult };
  "open-location-settings": { args: []; result: OperationResult };
  "get-wifi-info": { args: []; result: WifiInfoResult };
  "biometric:available": { args: []; result: BiometricAvailability };
  "biometric:enroll": { args: [payload: BiometricEnrollment]; result: OperationResult };
  "biometric:login": { args: []; result: BiometricLoginResult };
  "biometric:disable": { args: []; result: OperationResult };
}

/** Fire-and-forget messages sent by a renderer. */
export interface SendContract {
  "window-minimize": []; "window-maximize": []; "window-close": [];
  "download-update": []; "install-update": [];
  "screen-source-selected": [sourceId: string | null];
  "flash-frame": [flash: boolean]; "show-and-focus": [];
  "set-badge-count": [count: number];
  "call:pip-open": [state: CallPipState]; "call:pip-close": [];
  "call:pip-update-state": [partial: CallPipState]; "call:pip-ready": [];
  "call:pip-action": [payload: { action: CallPipAction }];
}

/** Notifications emitted by main to a renderer. */
export interface ListenerContract {
  "maximize-change": [maximized: boolean];
  "update-available": [info: UpdateInfoPayload];
  "download-progress": [info: UpdateInfoPayload];
  "update-downloaded": [info: UpdateInfoPayload];
  "update-reminder": [info: UpdateInfoPayload];
  "update-not-available": [];
  "update-error": [info: UpdateInfoPayload];
  "screen-sources": [sources: ScreenSource[]];
  "window-hidden": [payload: WindowVisibility]; "window-shown": [payload: WindowVisibility];
  "call:pip-window-closed": [];
  "call:pip-action": [payload: { action?: CallPipAction }];
  "call:pip-state": [state: CallPipState];
}

export const INVOKE_CHANNELS = ["get-app-version", "is-maximized", "check-for-update", "fetch-release-notes", "get-ip-location", "get-native-location", "open-location-settings", "get-wifi-info", "biometric:available", "biometric:enroll", "biometric:login", "biometric:disable"] as const satisfies readonly (keyof InvokeContract)[];
export const SEND_CHANNELS = ["window-minimize", "window-maximize", "window-close", "download-update", "install-update", "screen-source-selected", "flash-frame", "show-and-focus", "set-badge-count", "call:pip-open", "call:pip-close", "call:pip-update-state", "call:pip-ready", "call:pip-action"] as const satisfies readonly (keyof SendContract)[];
export const LISTENER_CHANNELS = ["maximize-change", "update-available", "download-progress", "update-downloaded", "update-reminder", "update-not-available", "update-error", "screen-sources", "window-hidden", "window-shown", "call:pip-window-closed", "call:pip-action", "call:pip-state"] as const satisfies readonly (keyof ListenerContract)[];
export type RendererInvoke = <C extends keyof InvokeContract>(channel: C, ...args: InvokeContract[C]["args"]) => Promise<InvokeContract[C]["result"]>;
export type RendererSend = <C extends keyof SendContract>(channel: C, ...args: SendContract[C]) => void;
export type RendererOn = <C extends keyof ListenerContract>(channel: C, listener: (event: IpcRendererEvent, ...args: ListenerContract[C]) => void) => void;

export function handleIpc<C extends keyof InvokeContract>(channel: C, listener: (event: IpcMainInvokeEvent, ...args: InvokeContract[C]["args"]) => InvokeContract[C]["result"] | Promise<InvokeContract[C]["result"]>): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  ipcMain.handle(channel, listener as never);
}
export function onIpc<C extends keyof SendContract>(channel: C, listener: (event: IpcMainEvent, ...args: SendContract[C]) => void): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  ipcMain.on(channel, listener as never);
}
export function sendIpc<C extends keyof ListenerContract>(target: WebContents, channel: C, ...args: ListenerContract[C]): void { target.send(channel, ...args); }

export interface ElectronAPI {
  platform: NodeJS.Platform;
  isElectron: true;
  getVersion(): Promise<string>;
  isMaximized(): Promise<boolean>;
  minimize(): void; maximize(): void; close(): void;
  onMaximizeChange(callback: (value: boolean) => void): void;
  removeMaximizeChange(callback: (value: boolean) => void): void;
  onUpdateAvailable(callback: (value: UpdateInfoPayload) => void): Unsubscribe;
  onDownloadProgress(callback: (value: UpdateInfoPayload) => void): Unsubscribe;
  onUpdateDownloaded(callback: (value: UpdateInfoPayload) => void): Unsubscribe;
  onUpdateReminder(callback: (value: UpdateInfoPayload) => void): Unsubscribe;
  onUpdateNotAvailable(callback: (value: Record<string, never>) => void): Unsubscribe;
  onUpdateError(callback: (value: UpdateInfoPayload) => void): Unsubscribe;
  checkForUpdate(): Promise<UpdateCheckResult>;
  downloadUpdate(): void; installUpdate(): void;
  fetchReleaseNotes(version: string): Promise<string>;
  onScreenSources(callback: (value: ScreenSource[]) => void): Unsubscribe;
  selectScreenSource(sourceId: string | null): void;
  flashFrame(flash: boolean): void; showAndFocus(): void; setBadgeCount(count: number): void;
  getIpLocation(): Promise<LocationResult>; getNativeLocation(): Promise<LocationResult>;
  openLocationSettings(): Promise<OperationResult>; getWifiInfo(): Promise<WifiInfoResult>;
  onWindowHidden(callback: (value: WindowVisibility) => void): Unsubscribe;
  onWindowShown(callback: (value: WindowVisibility) => void): Unsubscribe;
  callPip: {
    open(state: CallPipState): void; close(): void; updateState(partial: CallPipState): void;
    onWindowClosed(callback: () => void): Unsubscribe;
    onAction(callback: (payload: { action?: CallPipAction }) => void): Unsubscribe;
    ready(): void; sendAction(action: CallPipAction): void;
    onState(callback: (state: CallPipState) => void): Unsubscribe;
  };
  biometric: {
    available(): Promise<BiometricAvailability>;
    enroll(payload: BiometricEnrollment): Promise<OperationResult>;
    login(): Promise<BiometricLoginResult>; disable(): Promise<OperationResult>;
  };
}
