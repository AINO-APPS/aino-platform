// Payload and bridge types shared by the Electron main process and the web
// renderer. This file must stay free of `electron` imports: the client CI job
// typechecks these declarations but never installs desktop dependencies, so a
// value or type import from `electron` here breaks `client && npm run typecheck`.
// Electron-coupled helpers live in `ipc-contract.ts`, which re-exports this file.

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
export type MessageAlert = {
  conversationId: string; messageId: string; title: string; sender: string; preview: string;
  avatar: string | null; isGroup: boolean; members: Array<{ name?: string | null; avatar?: string | null }>;
  count: number; updatedAt: number; replyText: string; draftId: string; replyOpen: boolean;
  busy: boolean; error: string;
};
export type MessageAlertState = { session: string; cards: MessageAlert[]; dark: boolean; primary: string };
export type MessageAlertAction = {
  session: string; conversationId: string; messageId: string;
  action: "open" | "dismiss" | "read" | "reply" | "expand";
  text?: string;
};

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
  messageAlerts: {
    publish(state: MessageAlertState): void;
    clear(): void;
    ready(): void;
    resize(height: number): void;
    act(action: MessageAlertAction): void;
    onState(callback: (state: MessageAlertState) => void): Unsubscribe;
    onAction(callback: (action: MessageAlertAction) => void): Unsubscribe;
  };
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
