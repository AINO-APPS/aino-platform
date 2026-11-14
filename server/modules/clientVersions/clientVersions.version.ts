import { validVersion } from "./clientVersions.config";

function compareNumeric(left: string, right: string): number {
    return left.length === right.length ? (left < right ? -1 : left > right ? 1 : 0) : left.length < right.length ? -1 : 1;
}

export function compareVersions(left: string, right: string): number {
    // The gate's missing-version sentinel has the same precedence as 0.0.0.
    if (left === "0") left = "0.0.0";
    if (right === "0") right = "0.0.0";
    if (!validVersion(left) || !validVersion(right)) throw new Error("Cannot compare invalid semantic versions");
    const [leftCore, ...leftSuffix] = left.split("+")[0].split("-");
    const [rightCore, ...rightSuffix] = right.split("+")[0].split("-");
    const leftPre = leftSuffix.length ? leftSuffix.join("-") : undefined;
    const rightPre = rightSuffix.length ? rightSuffix.join("-") : undefined;
    const leftParts = leftCore.split(".");
    const rightParts = rightCore.split(".");
    for (let index = 0; index < 3; index++) {
        const result = compareNumeric(leftParts[index], rightParts[index]);
        if (result) return result;
    }
    if (leftPre === undefined || rightPre === undefined) {
        return leftPre === rightPre ? 0 : leftPre === undefined ? 1 : -1;
    }
    const leftIdentifiers = leftPre.split(".");
    const rightIdentifiers = rightPre.split(".");
    for (let index = 0; index < Math.max(leftIdentifiers.length, rightIdentifiers.length); index++) {
        const a = leftIdentifiers[index];
        const b = rightIdentifiers[index];
        if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
        if (a === b) continue;
        const aNumeric = /^\d+$/.test(a);
        const bNumeric = /^\d+$/.test(b);
        if (aNumeric && bNumeric) return compareNumeric(a, b);
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return a < b ? -1 : 1;
    }
    return 0;
}
