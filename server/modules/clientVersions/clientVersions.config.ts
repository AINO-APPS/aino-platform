import type { VersionConfig } from "./clientVersions.types";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function validVersion(value: unknown): value is string {
    return typeof value === "string" && value.length <= 128 && SEMVER.test(value);
}
export function readClientVersionConfig(env: NodeJS.ProcessEnv = process.env): VersionConfig {
    const minimum = (name: string) => validVersion(env[name]) ? env[name]! : "0.0.0";
    return {
        mode: env.CLIENT_VERSION_MODE === "report" ? "report" : "off",
        minimums: {
            android: minimum("CLIENT_VERSION_MIN_ANDROID"),
            desktop: minimum("CLIENT_VERSION_MIN_DESKTOP"),
            web: minimum("CLIENT_VERSION_MIN_WEB"),
        },
    };
}
