export {};

jest.mock("../utils/ws", () => ({ sendToUser: jest.fn() }));
jest.mock("../platform/storage", () => ({ randomFilename: (kind: string, ext: string) => `${kind}_x.${ext}` }));
jest.mock("../services/chatAttachments", () => ({ deleteChatAttachment: jest.fn() }));
jest.mock("../modules/chat/chat.service", () => ({ createChatService: () => ({}) }));

const { chatStoredType, normalizeChatUpload, chatFilename, GENERIC_FILE_TYPE } = require("../modules/chat/chat.shared");
const { chatMediaPreview } = require("../utils/chatMediaMetadata");

const text = (value: string) => Buffer.from(value, "utf8");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("chat uploads accept any file type (Signal parity)", () => {
    test("known types keep their MIME only when the bytes match", () => {
        expect(chatStoredType("image/png", png)).toBe("image/png");
        expect(chatStoredType("application/pdf", text("%PDF-1.7"))).toBe("application/pdf");
        expect(chatStoredType("image/png", text("<html><script>"))).toBe(GENERIC_FILE_TYPE);
    });

    test("SVG, HTML, executables and unknown types are stored as opaque downloads", () => {
        expect(chatStoredType("image/svg+xml", text("<svg onload=alert(1)/>"))).toBe(GENERIC_FILE_TYPE);
        expect(chatStoredType("text/html", text("<html>"))).toBe(GENERIC_FILE_TYPE);
        expect(chatStoredType("application/x-msdownload", Buffer.from([0x4d, 0x5a]))).toBe(GENERIC_FILE_TYPE);
        expect(chatStoredType("", text("x"))).toBe(GENERIC_FILE_TYPE);
        expect(chatFilename(1, GENERIC_FILE_TYPE)).toBe("chat_x.bin");
    });

    test("middleware rewrites the declared type and passes file-less requests", () => {
        const next = jest.fn();
        const req: any = { file: { mimetype: "image/svg+xml", buffer: text("<svg/>") } };
        normalizeChatUpload(req, {}, next);
        expect(req.file.mimetype).toBe(GENERIC_FILE_TYPE);
        normalizeChatUpload({} as any, {}, next);
        expect(next).toHaveBeenCalledTimes(2);
    });
});

describe("attachment push preview", () => {
    test("view-once never reveals the file name or caption", () => {
        expect(chatMediaPreview({ fileType: "image/jpeg", fileName: "secret.jpg", caption: "hi", viewOnce: true })).toBe("Photo");
        expect(chatMediaPreview({ fileType: "video/mp4", fileName: "secret.mp4", viewOnce: true })).toBe("Video");
    });

    test("media types use Signal labels, files use their name, captions win", () => {
        expect(chatMediaPreview({ fileType: "image/png", fileName: "a.png" })).toBe("Photo");
        expect(chatMediaPreview({ fileType: "image/gif" })).toBe("GIF");
        expect(chatMediaPreview({ fileType: "video/mp4" })).toBe("Video");
        expect(chatMediaPreview({ fileType: "audio/mp4" })).toBe("Voice message");
        expect(chatMediaPreview({ fileType: "application/octet-stream", fileName: "logo.svg" })).toBe("logo.svg");
        expect(chatMediaPreview({ fileType: "image/png", caption: " Look " })).toBe("Look");
    });
});
