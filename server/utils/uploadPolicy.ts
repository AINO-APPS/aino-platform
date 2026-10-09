import type { Request, Response, NextFunction } from "express";

/**
 * Upload content checks (P2.3). Multer's `fileFilter` only sees the MIME type
 * the client *declared*. After buffering, every upload route also runs
 * [verifyUploadContent] to check that the file's leading bytes match that type,
 * so an HTML page, script or executable cannot be stored as `image/png` and
 * later served from our storage origin. No antivirus service: allowlist +
 * size caps + content sniffing (decided 2026-10-09).
 */

type Sniffer = (bytes: Buffer) => boolean;

const startsWith = (bytes: Buffer, signature: number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Buffer, text: string, offset = 0): boolean =>
    startsWith(bytes, [...Buffer.from(text, "latin1")], offset);

/** ISO-BMFF (`ftyp` box at byte 4): MP4, MOV, M4A, 3GP, HEIC. */
const isoBmff: Sniffer = (b) => ascii(b, "ftyp", 4);
const zip: Sniffer = (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
const ole: Sniffer = (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ebml: Sniffer = (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]);

/**
 * Plain text (TXT / CSV / JSON): valid UTF-8 without NUL bytes, and nothing a
 * browser would sniff as active content when opened directly.
 */
const plainText: Sniffer = (b) => {
    let end = Math.min(b.length, 8192);
    // Don't cut a multi-byte UTF-8 character in half at the sample boundary.
    if (end < b.length) while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
    const head = b.subarray(0, end);
    if (head.includes(0)) return false;
    const text = head.toString("utf8");
    if (text.includes("\uFFFD")) return false;
    return !/^\s*<(?:!doctype|html|script|svg|\?xml|body|head|iframe)/i.test(text);
};

const SNIFFERS: Record<string, Sniffer> = {
    "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    "image/jpg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/gif": (b) => ascii(b, "GIF87a") || ascii(b, "GIF89a"),
    "image/webp": (b) => ascii(b, "RIFF") && ascii(b, "WEBP", 8),
    "image/bmp": (b) => ascii(b, "BM"),
    "video/mp4": isoBmff,
    "video/quicktime": (b) => isoBmff(b) || ascii(b, "moov", 4) || ascii(b, "mdat", 4) || ascii(b, "wide", 4),
    "video/webm": ebml,
    "audio/webm": ebml,
    "audio/mp4": isoBmff,
    "audio/mpeg": (b) => ascii(b, "ID3") || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    "audio/ogg": (b) => ascii(b, "OggS"),
    "audio/wav": (b) => ascii(b, "RIFF") && ascii(b, "WAVE", 8),
    "audio/x-wav": (b) => ascii(b, "RIFF") && ascii(b, "WAVE", 8),
    "application/pdf": (b) => ascii(b, "%PDF-"),
    "application/zip": zip,
    "application/x-zip-compressed": zip,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": zip,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": zip,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": zip,
    "application/msword": ole,
    "application/vnd.ms-excel": ole,
    "text/plain": plainText,
    "text/csv": plainText,
    "application/json": plainText,
};

/** True when [bytes] look like [mimetype]. Unknown types are refused. */
export function contentMatchesType(mimetype: string, bytes: Buffer | undefined): boolean {
    const sniff = SNIFFERS[String(mimetype || "").toLowerCase()];
    return !!sniff && !!bytes && bytes.length > 0 && sniff(bytes);
}

/** A display-safe original file name: no path, control or markup characters, bounded length. */
export function safeOriginalName(name: unknown, fallback = "file"): string {
    const base = String(name ?? "").split(/[\\/]/).pop() || "";
    const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/^\.+/, "").trim().slice(0, 200);
    return cleaned || fallback;
}

/**
 * Express middleware placed right after a multer handler: refuses the request
 * (415) when the buffered file's content does not match its declared type.
 * Requests without a file pass through (routes decide whether one is required).
 */
export function verifyUploadContent(req: Request, res: Response, next: NextFunction): void | Response {
    const file = (req as any).file as { mimetype: string; buffer?: Buffer } | undefined;
    if (!file) return next();
    if (!contentMatchesType(file.mimetype, file.buffer)) {
        return res.status(415).json({
            error: "The file's contents do not match its type.",
            code: "UPLOAD_CONTENT_MISMATCH",
        });
    }
    next();
}
