import path from "path";

export const DEFAULT_API_SERVER = "https://www.aino.org.in";
export const R2_ORIGIN_PATTERN = "https://*.r2.cloudflarestorage.com";

export interface DesktopConfig {
  apiServer: string;
  clientDist: string;
  windowStateFile: string;
  versionFile: string;
}

export function createDesktopConfig(options: {
  apiServer?: string;
  isPackaged: boolean;
  resourcesPath: string;
  dirname: string;
  userData: string;
}): DesktopConfig {
  return {
    apiServer: options.apiServer || DEFAULT_API_SERVER,
    clientDist: options.isPackaged
      ? path.join(options.resourcesPath, "client", "dist")
      : path.join(options.dirname, "..", "client", "dist"),
    windowStateFile: path.join(options.userData, "window-state.json"),
    versionFile: path.join(options.userData, "last-version.txt"),
  };
}
