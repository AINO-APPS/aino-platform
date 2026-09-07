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
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return DEFAULT_WINDOW_STATE;
    return value as WindowState;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}