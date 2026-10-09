import type { CSSProperties } from "react";

/**
 * Signal-style last-message attachment label. Shows a type-aware emoji + word
 * (Photo / Video / GIF / Voice message / Audio / Document) instead of a plain
 * "Attachment". Falls back gracefully when type metadata is missing.
 */
export function attachmentPreview(
  fileType?: string | null,
  fileName?: string | null,
  fileUrl?: string | null,
): string {
  const type = (fileType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const url = (fileUrl || "").toLowerCase();

  if (url.includes("voice") || name.startsWith("voice."))
    return "🎤 Voice message";
  if (type === "image/gif" || name.endsWith(".gif")) return "🎞️ GIF";
  if (type.startsWith("image/")) return "📷 Photo";
  if (type.startsWith("video/")) return "🎥 Video";
  if (type.startsWith("audio/")) return "🎵 Audio";
  if (type.includes("pdf")) return "📄 PDF";
  if (type.includes("spreadsheet") || type.includes("excel"))
    return "📊 Spreadsheet";
  if (type.includes("word") || type.includes("document")) return "📝 Document";
  if (type.includes("zip") || type.includes("compressed")) return "🗜️ Archive";
  if (fileName) return `📎 ${fileName}`;
  return "📎 Attachment";
}

/**
 * Signal-style conversation-list delivery tick for the caller's OWN last
 * message: sent (bare ✓) → delivered (circled ✓) → read (accent-filled ✓).
 * Mirrors the in-thread DeliveryStatus glyphs so both screens read the same.
 */
export function ListTick({ conv, userId }: { conv: any; userId?: number | string }) {
  if (userId == null || Number(conv.last_sender_id) !== Number(userId))
    return null;
  if (conv.last_format_type === "system" || conv.last_deleted) return null;
  const read = !!conv.last_message_read;
  const delivered = !!conv.last_message_delivered;
  // Sits on the right edge of the preview row, directly under the timestamp.
  const style: CSSProperties = {
    display: "inline-flex",
    verticalAlign: "middle",
    marginLeft: "auto",
    paddingLeft: "6px",
    flexShrink: 0,
    color: read ? "var(--primary)" : "var(--text-muted, #8a8f98)",
  };
  if (read) {
    return (
      <span style={style} title="Read" aria-label="Read">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="8" cy="8" r="5.2" fill="currentColor" />
          <path
            d="M5.4 8.1l1.8 1.8L10.7 6"
            stroke="var(--read-check-bg, #fff)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (delivered) {
    return (
      <span style={style} title="Delivered" aria-label="Delivered">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M4.6 8.2l2.2 2.2L11.4 5.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span style={style} title="Sent" aria-label="Sent">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
