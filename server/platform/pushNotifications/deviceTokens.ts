import type { QueryFn } from "../../types/domain";

interface DeviceTokenLogger {
    info(details: unknown, message: string): void;
    error(details: unknown, message: string): void;
}

export async function registerDeviceToken(
    query: QueryFn,
    userId: number,
    tenantId: number | null,
    deviceToken: string,
    platform: "ios" | "android",
    logger: DeviceTokenLogger,
): Promise<void> {
    if (!deviceToken || !deviceToken.trim()) {
        throw new Error("Device token is required");
    }

    try {
        await query(
            `
            INSERT INTO device_tokens (user_id, tenant_id, device_token, platform, last_seen_at, created_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (user_id, device_token) DO UPDATE
            SET platform = EXCLUDED.platform, last_seen_at = NOW()
            `,
            [userId, tenantId || null, deviceToken, platform],
        );

        logger.info({ userId, tenantId, platform }, "Device token registered");
    } catch (err) {
        logger.error({ err: (err as Error).message, userId }, "Failed to register device token");
        throw err;
    }
}

export async function getDeviceTokens(
    query: QueryFn,
    userId: number,
    tenantId: number | null,
    logger: DeviceTokenLogger,
): Promise<string[]> {
    try {
        const result = await query(
            `SELECT device_token FROM device_tokens
             WHERE user_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
             AND created_at > NOW() - INTERVAL '1 year'`,
            [userId, tenantId || null],
        );
        return result.rows.map((row: any) => row.device_token);
    } catch (err) {
        const message = (err as Error).message || "";
        if (/device_tokens.*does not exist|relation .*device_tokens/i.test(message)) {
            logger.error(
                { err: message, userId, tenantId },
                "device_tokens table missing for tenant — run migrations (initTenantSchema / 2026_06_v13). Push notifications disabled until fixed.",
            );
        } else {
            logger.error({ err: message, userId, tenantId }, "Failed to get device tokens");
        }
        return [];
    }
}
