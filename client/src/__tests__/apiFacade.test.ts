import { beforeEach, describe, expect, test, vi } from "vitest";

const { axiosInstance, create, axiosGet, progress } = vi.hoisted(() => {
    const axiosInstance = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    };
    return {
        axiosInstance,
        create: vi.fn(() => axiosInstance),
        axiosGet: vi.fn(),
        progress: { configure: vi.fn(), start: vi.fn(), done: vi.fn() },
    };
});

vi.mock("axios", () => ({ default: { create, get: axiosGet } }));
vi.mock("nprogress", () => ({ default: progress }));
vi.mock("nprogress/nprogress.css", () => ({}));

import API, { baseURL, serverURL } from "../api/client";
import { addTaskComment, getTasks } from "../api/tasks";
import { getPublicNote } from "../api/notes";
import { uploadChatFile } from "../api/chat";
import * as compatibilityFacade from "../api";

beforeEach(() => {
    axiosInstance.get.mockClear();
    axiosInstance.post.mockClear();
    axiosGet.mockClear();
    progress.start.mockClear();
    progress.done.mockClear();
});

describe("shared API client contract", () => {
    test("preserves the default client identity and security defaults", () => {
        expect(compatibilityFacade.default).toBe(API);
        expect(create).toHaveBeenCalledWith({
            baseURL,
            withCredentials: true,
            headers: { "X-Requested-With": "WorkPulse" },
        });
        expect(serverURL).toBe("");
    });

    test("preserves timezone and NProgress interceptors", async () => {
        const request = axiosInstance.interceptors.request.use.mock.calls[0][0];
        const [fulfilled, rejected] = axiosInstance.interceptors.response.use.mock.calls[0];
        const config = { headers: {} as Record<string, unknown> };
        expect(request(config)).toBe(config);
        expect(config.headers["x-timezone-offset"]).toBe(new Date().getTimezoneOffset());
        expect(progress.start).toHaveBeenCalledOnce();
        expect(fulfilled({ ok: true })).toEqual({ ok: true });
        await expect(rejected(new Error("nope"))).rejects.toThrow("nope");
        expect(progress.done).toHaveBeenCalledTimes(2);
    });
});

describe("domain request compatibility", () => {
    test("preserves task params and cancellation", () => {
        const signal = new AbortController().signal;
        getTasks("2026-09-07", undefined, signal);
        expect(axiosInstance.get).toHaveBeenCalledWith("/tasks", {
            params: { date: "2026-09-07" }, signal,
        });
    });

    test("preserves multipart task comments", () => {
        const file = new File(["hello"], "hello.txt", { type: "text/plain" });
        addTaskComment(42, "caption", file);
        const [url, body, config] = axiosInstance.post.mock.calls[0];
        expect(url).toBe("/tasks/42/comments");
        expect(body).toBeInstanceOf(FormData);
        expect(body.get("content")).toBe("caption");
        expect(body.get("file")).toBe(file);
        expect(config).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
    });

    test("preserves chat upload progress and cancellation", () => {
        const signal = new AbortController().signal;
        const onUploadProgress = vi.fn();
        const body = new FormData();
        uploadChatFile("conv/1", body, { signal, onUploadProgress });
        const [url, sentBody, config] = axiosInstance.post.mock.calls[0];
        expect(url).toBe("/chat/conversations/conv/1/files");
        expect(sentBody).toBe(body);
        expect(config).toEqual({
            headers: { "Content-Type": "multipart/form-data" }, signal, onUploadProgress,
        });
    });

    test("keeps public notes anonymous on the global axios identity", () => {
        getPublicNote("a/b");
        expect(axiosGet).toHaveBeenCalledWith(`${baseURL}/public/notes/a%2Fb`);
        expect(axiosInstance.get).not.toHaveBeenCalled();
    });
});
