export type RoutedPushType = "call" | "message" | "call_cancel" | "session_revoked" | "reaction";
import { messageDataBytes, MESSAGE_DATA_BUDGET_BYTES, validGroupMemberPreviews } from "./messageAvatars";

interface ContractLogger {
    error(details: unknown, message: string): void;
}

const FIELDS: Record<RoutedPushType, { present: string[]; nonEmpty: string[] }> = {
    call: {
        present: ["type", "callId", "conversationId", "callerId", "dedupeKey", "expiresAt", "sentAt"],
        nonEmpty: ["type", "callId", "conversationId", "callerId", "dedupeKey", "expiresAt", "sentAt"],
    },
    message: {
        present: ["type", "conversationId", "messageId", "senderId", "dedupeKey", "sentAt"],
        nonEmpty: ["type", "conversationId", "messageId", "senderId", "senderName", "dedupeKey", "sentAt"],
    },
    call_cancel: {
        present: ["type", "callId", "conversationId", "dedupeKey", "sentAt"],
        nonEmpty: ["type", "callId", "conversationId", "dedupeKey", "sentAt"],
    },
    session_revoked: {
        present: ["type", "reason", "dedupeKey", "sentAt"],
        nonEmpty: ["type", "reason", "dedupeKey", "sentAt"],
    },
    reaction: {
        present: ["type", "title", "body", "conversationId", "messageId", "messageOwnerId", "actorId", "actorName", "actorAvatar", "emoji", "reactionId", "action", "dedupeKey", "tenantId", "sentAt", "expiresAt"],
        nonEmpty: ["type", "title", "body", "conversationId", "messageId", "messageOwnerId", "actorId", "actorName", "emoji", "reactionId", "action", "dedupeKey", "sentAt", "expiresAt"],
    },
};

export function buildCommonPushData(
    base: Record<string, string>,
    tenantId: number | null,
): Record<string, string> {
    return {
        ...base,
        tenantId: tenantId != null ? String(tenantId) : "",
        sentAt: new Date().toISOString(),
    };
}

export function assertRoutingPayloadContract(
    notificationType: RoutedPushType,
    data: Record<string, string>,
    logger: ContractLogger,
): void {
    const { present: presentFields, nonEmpty: nonEmptyFields } = FIELDS[notificationType];
    const missing = presentFields.filter((field) => !(field in data));
    const empty = nonEmptyFields.filter((field) => !data[field]);
    const invalid: string[] = [];

    if (notificationType === "call") {
        if (data.type !== "incoming_call") invalid.push("type");
        if (!/^call:\d+$/.test(data.dedupeKey || "")) invalid.push("dedupeKey");
        if (Number.isNaN(Date.parse(data.expiresAt || ""))) invalid.push("expiresAt");
    } else if (notificationType === "call_cancel") {
        if (data.type !== "call_handled_elsewhere") invalid.push("type");
        if (!/^call_cancel:\d+$/.test(data.dedupeKey || "")) invalid.push("dedupeKey");
    } else if (notificationType === "session_revoked") {
        if (data.type !== "session_revoked") invalid.push("type");
        if (data.reason !== "signed_in_elsewhere") invalid.push("reason");
        if (!/^session_revoked:\d+$/.test(data.dedupeKey || "")) invalid.push("dedupeKey");
    } else if (notificationType === "reaction") {
        if (data.type !== "chat_reaction") invalid.push("type");
        if (data.action !== "added") invalid.push("action");
        for (const field of ["conversationId", "messageId", "messageOwnerId", "actorId", "reactionId", "expiresAt"]) {
            if (!/^[1-9]\d*$/.test(data[field] || "") || !Number.isSafeInteger(Number(data[field]))) invalid.push(field);
        }
        if (data.actorId === data.messageOwnerId) invalid.push("actorId");
        if (data.dedupeKey !== `reaction:${data.reactionId}`) invalid.push("dedupeKey");
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.sentAt || "")) invalid.push("sentAt");
        if (Number(data.expiresAt) * 1000 <= Date.parse(data.sentAt)) invalid.push("expiresAt");
        if (data.tenantId && !/^[1-9]\d*$/.test(data.tenantId)) invalid.push("tenantId");
        if (Object.keys(data).some((field) => !presentFields.includes(field))) invalid.push("unknownFields");
        if (Object.values(data).some((value) => typeof value !== "string")) invalid.push("dataTypes");
    } else {
        if (data.type !== "chat_message") invalid.push("type");
        if (!/^msg:\d+$/.test(data.dedupeKey || "")) invalid.push("dedupeKey");
        if ("groupAvatar" in data || "groupMemberPreviews" in data) {
            if (data.isGroup !== "true") invalid.push("isGroup");
            if (Buffer.byteLength(data.groupAvatar || "", "utf8") > 2048) invalid.push("groupAvatar");
            if (data.groupMemberPreviews !== undefined) {
                try {
                    if (Buffer.byteLength(data.groupMemberPreviews, "utf8") > 2048 ||
                        !validGroupMemberPreviews(JSON.parse(data.groupMemberPreviews))) invalid.push("groupMemberPreviews");
                } catch { invalid.push("groupMemberPreviews"); }
            }
            if (messageDataBytes(data) > MESSAGE_DATA_BUDGET_BYTES) invalid.push("payloadBudget");
        }
    }

    if (Number.isNaN(Date.parse(data.sentAt || ""))) invalid.push("sentAt");

    if (missing.length > 0 || empty.length > 0 || invalid.length > 0) {
        logger.error(
            { notificationType, missing, empty, invalid },
            "Push payload contract validation failed",
        );
        throw new Error(`Invalid ${notificationType} push payload contract`);
    }
}
