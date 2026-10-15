import { afterEach, describe, expect, test, vi } from "vitest";
import { handOffLocalPreview, localMediaFor, rememberLocalMedia } from "../components/chat/chatMediaMemory";

describe("chatMediaMemory", () => {
    afterEach(() => vi.restoreAllMocks());

    test("keeps image/video blobs for the remote URL and revokes everything else", () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        handOffLocalPreview({ file_url: "/uploads/a.jpg", file_type: "image/jpeg" }, "blob:a");
        expect(localMediaFor("/uploads/a.jpg")).toBe("blob:a");
        handOffLocalPreview({ file_url: "/uploads/v.webm", file_type: "audio/webm" }, "blob:v");
        expect(localMediaFor("/uploads/v.webm")).toBeUndefined();
        expect(revoke).toHaveBeenCalledWith("blob:v");
    });

    test("bounds the memory and revokes evicted blobs", () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        for (let i = 0; i < 51; i++) rememberLocalMedia(`/uploads/lru-${i}.png`, `blob:lru-${i}`);
        expect(localMediaFor("/uploads/lru-50.png")).toBe("blob:lru-50");
        expect(revoke).toHaveBeenCalled();
        expect(revoke.mock.calls.flat()).not.toContain("blob:lru-50");
    });
});
