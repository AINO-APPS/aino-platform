import { desktopCapturer, type BrowserWindow, type DesktopCapturerSource, type IpcMainEvent, type Session } from "electron";
import { onIpc, sendIpc } from "./ipc-contract";

export function setupScreenCapture(electronSession: Session, getWindow: () => BrowserWindow | null): void {
// ─── Screen sharing: show picker so user can choose which screen/window ───
let pendingSourceSelection: {
  sources: DesktopCapturerSource[];
  callback: (streams: Electron.Streams) => void;
} | null = null;

// Safely invoke the displayMedia callback. Recent Electron versions throw
// "Video was requested, but no video stream was provided" if you call
// callback({}) to cancel — wrap in try/catch so a user cancel doesn't
// crash the main process.
const safeInvokeCallback = (
  callback: (streams: Electron.Streams) => void,
  streams: Electron.Streams,
): void => {
  try {
    callback(streams);
  } catch (err) {
    console.warn(
      "[AINO] displayMedia callback error (likely user cancel):",
      (err as Error)?.message,
    );
  }
};

electronSession.setDisplayMediaRequestHandler(
  async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      // Send source list to renderer for user selection
      const serialized = sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      }));
      getWindow() && sendIpc(getWindow()!.webContents, "screen-sources", serialized);

      // Wait for user to pick a source or cancel
      pendingSourceSelection = { sources, callback };
    } catch {
      safeInvokeCallback(callback, {} as Electron.Streams);
    }
  },
);

onIpc("screen-source-selected", (_e: IpcMainEvent, sourceId: string | null) => {
  if (!pendingSourceSelection) return;
  const { sources, callback } = pendingSourceSelection;
  pendingSourceSelection = null;
  if (!sourceId) {
    safeInvokeCallback(callback, {} as Electron.Streams); // user cancelled
    return;
  }
  const selected = sources.find((s) => s.id === sourceId);
  if (selected) {
    safeInvokeCallback(callback, { video: selected, audio: "loopback" });
  } else {
    safeInvokeCallback(callback, {} as Electron.Streams);
  }
});
}
