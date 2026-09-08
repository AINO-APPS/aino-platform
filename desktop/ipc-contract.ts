import type { IpcMainEvent, IpcMainInvokeEvent, IpcRendererEvent, WebContents } from "electron";
import type {
  BiometricAvailability, BiometricEnrollment, BiometricLoginResult, CallPipAction, CallPipState,
  LocationResult, OperationResult, ScreenSource, UpdateCheckResult, UpdateInfoPayload,
  WifiInfoResult, WindowVisibility,
} from "./ipc-types";

// Payload and bridge types live in `ipc-types.ts` so the web renderer can
// typecheck them without installing Electron. They are re-exported here so
// existing main-process and renderer imports keep resolving unchanged.
export type * from "./ipc-types";

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
  const { assertTrustedIpcSender } = require("./ipcSecurity") as typeof import("./ipcSecurity");
  ipcMain.handle(channel, ((event: IpcMainInvokeEvent, ...args: InvokeContract[C]["args"]) => {
    assertTrustedIpcSender(event);
    return listener(event, ...args);
  }) as never);
}
export function onIpc<C extends keyof SendContract>(channel: C, listener: (event: IpcMainEvent, ...args: SendContract[C]) => void): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  const { assertTrustedIpcSender } = require("./ipcSecurity") as typeof import("./ipcSecurity");
  ipcMain.on(channel, ((event: IpcMainEvent, ...args: SendContract[C]) => {
    try { assertTrustedIpcSender(event); } catch { return; }
    listener(event, ...args);
  }) as never);
}
export function sendIpc<C extends keyof ListenerContract>(target: WebContents, channel: C, ...args: ListenerContract[C]): void { target.send(channel, ...args); }


