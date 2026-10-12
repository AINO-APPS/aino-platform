import type { MessageAlert, MessageAlertAction, MessageAlertState } from "./ipc-types";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
function id(value: unknown): value is string {
  return text(value, 16) && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}
function image(value: unknown): boolean {
  return value === null || (text(value, 2048) && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value)));
}
function card(value: unknown): value is MessageAlert {
  return record(value) && id(value.conversationId) && id(value.messageId) && text(value.title, 120)
    && text(value.sender, 120) && text(value.preview, 200) && image(value.avatar) && typeof value.isGroup === "boolean"
    && Array.isArray(value.members) && value.members.length <= 4 && value.members.every((member: unknown) =>
      record(member) && (member.name == null || text(member.name, 120)) && image(member.avatar ?? null))
    && typeof value.count === "number" && Number.isSafeInteger(value.count) && value.count > 0
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
    && text(value.replyText, 5000) && text(value.draftId, 64) && value.draftId.length > 0
    && typeof value.replyOpen === "boolean" && typeof value.busy === "boolean" && text(value.error, 1000);
}
export function isMessageAlertState(value: unknown): value is MessageAlertState {
  return record(value) && text(value.session, 150) && value.session.length > 0 && typeof value.dark === "boolean"
    && text(value.primary, 9) && /^#[0-9a-f]{3,8}$/i.test(value.primary)
    && Array.isArray(value.cards) && value.cards.length <= 3 && value.cards.every(card)
    && new Set(value.cards.map((item) => item.conversationId)).size === value.cards.length;
}
export function isMessageAlertAction(value: unknown, state: MessageAlertState | null): value is MessageAlertAction {
  return record(value) && !!state && value.session === state.session
    && id(value.conversationId) && id(value.messageId)
    // A newer message may replace the card between render and click; act on what the user saw.
    && state.cards.some((item) => item.conversationId === value.conversationId && Number(value.messageId) <= Number(item.messageId))
    && ["open", "dismiss", "read", "mute", "reply", "expand"].includes(String(value.action))
    && (value.text === undefined || text(value.text, 5000))
    && (value.duration === undefined || value.duration === "1h" || value.duration === "always");
}
export function messagePopupBounds(area: { x: number; y: number; width: number; height: number }, cards: number) {
  const margin = Math.min(16, Math.floor(Math.min(area.width, area.height) / 4));
  const width = Math.min(414, area.width - margin * 2);
  const height = Math.min(area.height - margin * 2, Math.max(240, cards * 340));
  return { width, height, x: area.x + area.width - width - margin, y: area.y + area.height - height - margin };
}
