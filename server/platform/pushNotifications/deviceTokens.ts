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
    platform: "ios" | "android" | "web",
    logger: DeviceTokenLogger,
    pushVersion = 1,
    deviceId: string | null = null,
): Promise<void> {
    if (!deviceToken || !deviceToken.trim()) {
        throw new Error("Device token is required");
    }

    try {
        try {
            await query(
                `
                INSERT INTO device_tokens (user_id, tenant_id, device_token, platform, push_version, device_id, last_seen_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                ON CONFLICT (user_id, device_token) DO UPDATE
                SET platform = EXCLUDED.platform, push_version = EXCLUDED.push_version,
                    device_id = COALESCE(EXCLUDED.device_id, device_tokens.device_id), last_seen_at = NOW()
                `,
                [userId, tenantId || null, deviceToken, platform, pushVersion, deviceId],
            );
        } catch (err) {
            if (!isMissingColumn(err)) throw err;
            // Database not yet migrated (0005 / 0010): register as a legacy token.
            await query(
                `
                INSERT INTO device_tokens (user_id, tenant_id, device_token, platform, last_seen_at, created_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW())
                ON CONFLICT (user_id, device_token) DO UPDATE
                SET platform = EXCLUDED.platform, last_seen_at = NOW()
                `,
                [userId, tenantId || null, deviceToken, platform],
            );
        }

        logger.info({ userId, tenantId, platform, pushVersion, hasDeviceId: !!deviceId }, "Device token registered");
    } catch (err) {
        logger.error({ err: (err as Error).message, userId }, "Failed to register device token");
        throw err;
    }
}

function isMissingColumn(err: unknown): boolean {
    return /push_version|device_id/i.test((err as Error)?.message || "");
}

function isMissingPushVersion(err: unknown): boolean {
    return /push_version/i.test((err as Error)?.message || "");
}

/**
 * Tokens split by push payload version. `linkAware` tokens (push_version >= 2)
 * accept the `link` / `linkTaskId` keys on general alerts; `legacy` tokens
 * (Android 0.14.0 and older validate an exact key set) must not receive them.
 */
export async function getDeviceTokenGroups(
    query: QueryFn,
    userId: number,
    tenantId: number | null,
    logger: DeviceTokenLogger,
): Promise<{ legacy: string[]; linkAware: string[] }> {
    try {
        const result = await query(
            `SELECT device_token, push_version FROM device_tokens
             WHERE user_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
             AND created_at > NOW() - INTERVAL '1 year'`,
            [userId, tenantId || null],
        );
        const legacy: string[] = [];
        const linkAware: string[] = [];
        for (const row of result.rows as any[]) {
            (Number(row.push_version) >= 2 ? linkAware : legacy).push(row.device_token);
        }
        return { legacy, linkAware };
    } catch (err) {
        if (!isMissingPushVersion(err)) {
            logger.error({ err: (err as Error).message, userId, tenantId }, "Failed to get device token groups");
        }
        return { legacy: await getDeviceTokens(query, userId, tenantId, logger), linkAware: [] };
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
