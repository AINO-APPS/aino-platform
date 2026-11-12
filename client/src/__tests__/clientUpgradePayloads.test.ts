import { Blob } from "node:buffer";
import { beforeEach, expect, test, vi } from "vitest";

beforeEach(() => vi.resetModules());
const body = { code: "CLIENT_UPGRADE_REQUIRED", client: "web", min_version: "3.0.80", current_version: "3.0.79" };
test.each(["json", "text", "blob", "arraybuffer"])("upgrade failures from %s API responses reach the global boundary", async type => {
    const { getClientUpgrade, inspectClientUpgrade } = await import("../api/clientUpgrade");
    const text = JSON.stringify(body);
    const data = type === "json" ? body : type === "text" ? text
        : type === "blob" ? new Blob([text]) : new TextEncoder().encode(text).buffer;
    expect(getClientUpgrade()).toBeNull();
    await inspectClientUpgrade({ status: 426, data });
    expect(getClientUpgrade()).toEqual(body);
});
