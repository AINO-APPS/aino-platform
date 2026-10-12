export interface GroupPushAvatarMetadata {
    groupAvatar: string | null;
    groupMemberPreviews: { name: string | null; avatar: string | null }[];
}

// Reserve room for the FCM envelope; JSON byte size is stricter than keys + values.
export const MESSAGE_DATA_BUDGET_BYTES = 3800;
export const GROUP_PREVIEWS_BUDGET_BYTES = 2048;
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
export const messageDataBytes = (data: Record<string, string>) => bytes(JSON.stringify(data));

interface AvatarLogger {
    warn(details: unknown, message: string): void;
}

export function fitMessagePushData(data: Record<string, string>, logger: AvatarLogger): Record<string, string> {
    if (messageDataBytes(data) <= MESSAGE_DATA_BUDGET_BYTES) return data;
    const result: Record<string, string> = { ...data, senderAvatar: "" };
    for (const field of ["body", "groupName", "title", "senderName"]) {
        if (messageDataBytes(result) <= MESSAGE_DATA_BUDGET_BYTES) break;
        const characters = Array.from(result[field] || "");
        let low = field === "title" || field === "senderName" ? 1 : 0;
        let high = characters.length;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            result[field] = characters.slice(0, mid).join("");
            if (messageDataBytes(result) <= MESSAGE_DATA_BUDGET_BYTES) low = mid;
            else high = mid - 1;
        }
        result[field] = characters.slice(0, low).join("");
    }
    logger.warn({ event: "push_message_data_bounded", conversationId: data.conversationId },
        "Oversized message push display data bounded; avatar URL omitted, never truncated");
    return result;
}

export function validGroupMemberPreviews(value: unknown): value is GroupPushAvatarMetadata["groupMemberPreviews"] {
    return Array.isArray(value) && value.length <= 4 && value.every(member =>
        member && typeof member === "object" && !Array.isArray(member) &&
        Object.keys(member).length === 2 && "name" in member && "avatar" in member &&
        (member.name === null || (typeof member.name === "string" && member.name.length <= 200)) &&
        (member.avatar === null || (typeof member.avatar === "string" && bytes(member.avatar) <= 2048)));
}

export function withGroupAvatarMetadata(
    data: Record<string, string>,
    metadata: GroupPushAvatarMetadata | undefined,
    logger: AvatarLogger,
): Record<string, string> {
    if (!metadata || data.isGroup !== "true") return data;
    const result = { ...data };
    const omit = (field: string, reason: string) => logger.warn({
        event: "push_avatar_metadata_omitted", conversationId: data.conversationId, field, reason,
    }, "Group avatar metadata omitted; Android will use authenticated conversation metadata");
    const add = (field: string, value: string) => {
        if (messageDataBytes({ ...result, [field]: value }) <= MESSAGE_DATA_BUDGET_BYTES) result[field] = value;
        else omit(field, "payload_budget");
    };
    if (metadata.groupAvatar === null || typeof metadata.groupAvatar === "string") {
        if (bytes(metadata.groupAvatar || "") <= 2048) add("groupAvatar", metadata.groupAvatar || "");
        else omit("groupAvatar", "field_budget");
    } else omit("groupAvatar", "invalid_shape");
    if (validGroupMemberPreviews(metadata.groupMemberPreviews)) {
        const serialized = JSON.stringify(metadata.groupMemberPreviews);
        if (bytes(serialized) <= GROUP_PREVIEWS_BUDGET_BYTES) add("groupMemberPreviews", serialized);
        else omit("groupMemberPreviews", "field_budget");
    } else omit("groupMemberPreviews", "invalid_shape");
    return result;
}
