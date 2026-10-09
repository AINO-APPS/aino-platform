export {};

const { contentMatchesType, safeOriginalName, verifyUploadContent } = require("../utils/uploadPolicy");

const bytes = (...values: number[]) => Buffer.from(values);
const text = (value: string) => Buffer.from(value, "utf8");

describe("upload content policy", () => {
    test.each([
        ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)],
        ["image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)],
        ["image/gif", text("GIF89a....")],
        ["image/webp", Buffer.concat([text("RIFF"), bytes(0, 0, 0, 0), text("WEBPVP8 ")])],
        ["video/mp4", Buffer.concat([bytes(0, 0, 0, 0x18), text("ftypmp42")])],
        ["audio/mp4", Buffer.concat([bytes(0, 0, 0, 0x18), text("ftypM4A ")])],
        ["video/webm", bytes(0x1a, 0x45, 0xdf, 0xa3, 1)],
        ["audio/mpeg", text("ID3\u0004....")],
        ["application/pdf", text("%PDF-1.7\n")],
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes(0x50, 0x4b, 0x03, 0x04, 0)],
        ["application/msword", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
        ["text/csv", text("name,email\nAna,ana@example.test\n")],
        ["text/plain", text("Meeting notes: ₹ 1,200 approved")],
    ])("accepts a real %s", (mimetype, content) => {
        expect(contentMatchesType(mimetype, content)).toBe(true);
    });

    test("refuses an HTML page or script disguised as an image or text", () => {
        expect(contentMatchesType("image/png", text("<html><script>alert(1)</script>"))).toBe(false);
        expect(contentMatchesType("text/plain", text("<!DOCTYPE html><html>"))).toBe(false);
        expect(contentMatchesType("text/plain", text("  <svg onload=alert(1)>"))).toBe(false);
        expect(contentMatchesType("application/pdf", bytes(0x4d, 0x5a, 0x90, 0))).toBe(false); // Windows executable
    });

    test("refuses binary content declared as text, empty files and unknown types", () => {
        expect(contentMatchesType("text/csv", bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe(false);
        expect(contentMatchesType("image/jpeg", Buffer.alloc(0))).toBe(false);
        expect(contentMatchesType("image/svg+xml", text("<svg/>"))).toBe(false);
        expect(contentMatchesType("application/x-msdownload", bytes(0x4d, 0x5a))).toBe(false);
    });

    test("a multi-byte character on the sample boundary is not mistaken for binary", () => {
        expect(contentMatchesType("text/csv", text("a".repeat(8191) + "é,ok\n"))).toBe(true);
        expect(contentMatchesType("text/plain", text("x".repeat(8190) + "हिन्दी text"))).toBe(true);
    });

    test("cleans display names", () => {
        expect(safeOriginalName("../../etc/passwd")).toBe("passwd");
        expect(safeOriginalName("C:\\Users\\a\\<b>report?.pdf")).toBe("breport.pdf");
        expect(safeOriginalName("...")).toBe("file");
        expect(safeOriginalName("x".repeat(300))).toHaveLength(200);
    });

    test("middleware answers 415 on a mismatch and passes real files and file-less requests", () => {
        const next = jest.fn();
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

        verifyUploadContent({ file: { mimetype: "image/png", buffer: text("<html>") } }, res, next);
        expect(res.status).toHaveBeenCalledWith(415);
        expect(next).not.toHaveBeenCalled();

        verifyUploadContent({ file: { mimetype: "application/pdf", buffer: text("%PDF-1.4") } }, res, next);
        verifyUploadContent({}, res, next);
        expect(next).toHaveBeenCalledTimes(2);
    });
});
