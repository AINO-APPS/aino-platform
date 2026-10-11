import type { CSSProperties, ReactNode } from "react";
import { Paperclip, Mic, Film, Image, Video, Music, FileText, FileSpreadsheet, Archive } from "../../constants/icons";
import { RippleTickGlyph, type TickState } from "../../components/chat/DeliveryStatus";

/**
 * Signal-style last-message attachment label. Shows a type-aware Material icon + word
 * (Photo / Video / GIF / Voice message / Audio / Document) instead of a plain
 * "Attachment". Falls back gracefully when type metadata is missing.
 */
export function attachmentPreview(
  fileType?: string | null,
  fileName?: string | null,
  fileUrl?: string | null,
): ReactNode {
  const type = (fileType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const url = (fileUrl || "").toLowerCase();

  if (url.includes("voice") || name.startsWith("voice."))
    return <><Mic size={14} style={{ verticalAlign: "middle" }} /> Voice message</>;
  if (type === "image/gif" || name.endsWith(".gif")) return <><Film size={14} style={{ verticalAlign: "middle" }} /> GIF</>;
  if (type.startsWith("image/")) return <><Image size={14} style={{ verticalAlign: "middle" }} /> Photo</>;
  if (type.startsWith("video/")) return <><Video size={14} style={{ verticalAlign: "middle" }} /> Video</>;
  if (type.startsWith("audio/")) return <><Music size={14} style={{ verticalAlign: "middle" }} /> Audio</>;
  if (type.includes("pdf")) return <><FileText size={14} style={{ verticalAlign: "middle" }} /> PDF</>;
  if (type.includes("spreadsheet") || type.includes("excel"))
    return <><FileSpreadsheet size={14} style={{ verticalAlign: "middle" }} /> Spreadsheet</>;
  if (type.includes("word") || type.includes("document")) return <><FileText size={14} style={{ verticalAlign: "middle" }} /> Document</>;
  if (type.includes("zip") || type.includes("compressed")) return <><Archive size={14} style={{ verticalAlign: "middle" }} /> Archive</>;
  if (fileName) return <><Paperclip size={14} style={{ verticalAlign: "middle" }} /> {fileName}</>;
  return <><Paperclip size={14} style={{ verticalAlign: "middle" }} /> Attachment</>;
}

/**
 * Conversation-list delivery tick for the caller's OWN last message, using the
 * same ripple-tick glyphs as the in-thread DeliveryStatus (read = org accent).
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
  const state: TickState = read ? "read" : delivered ? "delivered" : "sent";
  const label = read ? "Read" : delivered ? "Delivered" : "Sent";
  return (
    <span style={style} title={label} aria-label={label}>
      <RippleTickGlyph state={state} size={14} />
    </span>
  );
}
