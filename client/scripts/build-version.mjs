import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function getWebBuildVersion({
    releaseVersion = JSON.parse(readFileSync(new URL("../../desktop/package.json", import.meta.url), "utf8")).version,
    revision = process.env.GITHUB_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || sourceRevision(),
} = {}) {
    if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error("Invalid release metadata version");
    if (!/^[0-9a-f]{6,40}$/i.test(revision)) throw new Error("Invalid web source revision");
    return `${releaseVersion}+web.${revision.slice(0, 12)}`;
}

function sourceRevision() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        // Docker build contexts have no .git. This immutable build identifier is
        // still bundled, not read from the running app or a mutable remote file.
        return Date.now().toString(16);
    }
}
