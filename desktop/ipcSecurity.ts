import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

export function isTrustedRendererUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "workpulse:" && parsed.hostname === "app";
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url;
  if (!isTrustedRendererUrl(frameUrl) || event.senderFrame?.top !== event.senderFrame) {
    throw new Error("Rejected IPC from an untrusted renderer");
  }
}
