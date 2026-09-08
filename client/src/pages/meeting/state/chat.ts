export const PENDING_SEND_FAIL_AFTER_MS = 10_000;
export const PENDING_SEND_RETRY_EVERY_MS = 3_000;

/** Generate the stable id carried by optimistic chat and moderation frames. */
export function createClientMessageId(
  cryptoLike: Pick<Crypto, "randomUUID"> | undefined = globalThis.crypto,
): string {
  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  return `m_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function normalizeChatText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed || null;
}
