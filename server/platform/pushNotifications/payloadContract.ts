export type RoutedPushType = "call" | "message" | "call_cancel";

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
    } else {
        if (data.type !== "chat_message") invalid.push("type");
        if (!/^msg:\d+$/.test(data.dedupeKey || "")) invalid.push("dedupeKey");
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
