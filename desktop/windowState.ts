import fs from "fs";
import type { BrowserWindow } from "electron";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800 };

export function parseWindowState(raw: string | undefined): WindowState {
  if (!raw) return DEFAULT_WINDOW_STATE;
  try {
    const value = JSON.parse(raw) as Partial<WindowState>;
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width! < 800 || value.height! < 600) return DEFAULT_WINDOW_STATE;
    if (value.x !== undefined && !Number.isFinite(value.x)) return DEFAULT_WINDOW_STATE;
    if (value.y !== undefined && !Number.isFinite(value.y)) return DEFAULT_WINDOW_STATE;
    return { width: value.width!, height: value.height!, ...(value.x === undefined ? {} : { x: value.x }), ...(value.y === undefined ? {} : { y: value.y }), ...(typeof value.isMaximized === "boolean" ? { isMaximized: value.isMaximized } : {}) };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export function loadWindowState(file: string): WindowState {
  try { return parseWindowState(fs.readFileSync(file, "utf8")); }
  catch { return DEFAULT_WINDOW_STATE; }
}

export function createWindowStateSaver(file: string, delay = 500): (window: BrowserWindow | null) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (window) => {
    if (!window || window.isDestroyed()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!window || window.isDestroyed()) return;
      fs.writeFileSync(file, JSON.stringify({ ...window.getBounds(), isMaximized: window.isMaximized() }));
    }, delay);
  };
}