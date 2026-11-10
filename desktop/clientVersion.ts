import fs from "fs";
import path from "path";

export function readBundledWebVersion(clientDist: string): string | undefined {
  try {
    const version: unknown = JSON.parse(fs.readFileSync(path.join(clientDist, "client-version.json"), "utf8")).version;
    return typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}
