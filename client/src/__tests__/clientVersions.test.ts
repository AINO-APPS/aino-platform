import { afterEach, expect, test, vi } from "vitest";
import type { AxiosAdapter } from "axios";
import API from "../api/client";
import { getClientUpgrade } from "../api/clientUpgrade";

afterEach(() => {
    delete API.defaults.headers.common.Authorization;
    vi.unstubAllEnvs();
});

test("an unrelated API 426 becomes a global upgrade requirement even when the caller catches its error", async () => {
    const body = { code: "CLIENT_UPGRADE_REQUIRED", client: "web", min_version: "3.0.80", current_version: "3.0.79" };
    const adapter: AxiosAdapter = async (config) => {
        throw { response: { status: 426, data: body }, config };
    };
    await expect(API.get("/notifications", { adapter })).rejects.toBeDefined();
    expect(getClientUpgrade()).toEqual(body);
});

test("the desktop renderer sends its bundled WEB build version rather than asking the shell for a version", async () => {
    vi.stubEnv("VITE_ELECTRON", "true");
    const adapter: AxiosAdapter = async (config) => {
        expect(config.headers.get("X-AINO-Client")).toBe("desktop");
        expect(config.headers.get("X-AINO-Client-Version")).toMatch(/\+web\.[a-f0-9]+$/);
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    await API.get("/calendar", { adapter });
});

test("every first-party API request identifies the bundled web release, but signed third-party requests carry no identity or auth", async () => {
    const calls: any[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    API.defaults.headers.common.Authorization = "Bearer private";
    await API.get("/calendar", { adapter });
    expect(calls[0].headers.get("X-AINO-Client")).toBe("web");
    expect(calls[0].headers.get("X-AINO-Client-Version")).toMatch(/^3\.\d+\.\d+\+web\.[a-f0-9]+$/);
    expect(calls[0].headers.get("X-AINO-Client-Version")).not.toBe("1.0.0");
    await API.put("https://signed-bucket.example/object?signature=private", "bytes", { adapter });
    expect(calls[1].withCredentials).toBe(false);
    for (const header of ["Authorization", "Cookie", "X-AINO-Client", "X-AINO-Client-Version", "X-Requested-With"]) {
        expect(calls[1].headers.get(header)).toBeUndefined();
    }
});
