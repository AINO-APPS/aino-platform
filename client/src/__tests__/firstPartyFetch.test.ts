import { afterEach, expect, test, vi } from "vitest";
import { firstPartyFetch } from "../api/firstPartyFetch";
import { getClientUpgrade } from "../api/clientUpgrade";

afterEach(() => vi.unstubAllGlobals());
test("non-Axios same-origin API calls identify the build and handle upgrades without consuming the caller's body", async () => {
    const body = { code: "CLIENT_UPGRADE_REQUIRED", client: "web", min_version: "3.0.80", current_version: "3.0.79" };
    const fetch = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response(JSON.stringify(body), { status: 426 }));
    vi.stubGlobal("fetch", fetch);
    const response = await firstPartyFetch("/api/health", { cache: "no-store" });
    const options = fetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(options.headers).get("X-AINO-Client")).toBe("web");
    expect(new Headers(options.headers).get("X-AINO-Client-Version")).toMatch(/\+web\./);
    expect(await response.json()).toEqual(body);
    expect(getClientUpgrade()).toEqual(body);
});

test("signed-upload requests never receive cookies, authorization or first-party client headers", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    await firstPartyFetch("https://signed-bucket.example/object", {
        method: "PUT", credentials: "include",
        headers: { Authorization: "private", "X-AINO-Client": "web", "X-AINO-Client-Version": "3.0.80", "Content-Type": "video/webm" },
    });
    const options = fetch.mock.calls[0][1]!;
    expect(options.credentials).toBe("omit");
    const headers = new Headers(options.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-AINO-Client")).toBeNull();
    expect(headers.get("X-AINO-Client-Version")).toBeNull();
    expect(headers.get("Content-Type")).toBe("video/webm");
});
