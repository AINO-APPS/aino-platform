import type { App } from "firebase-admin/app";
import { getMessaging, type SendResponse } from "firebase-admin/messaging";
import type { QueryFn } from "../../types/domain";

export interface PushPayload {
    notification?: {
        title: string;
        body: string;
    };
    data: Record<string, string>;
    androidDataOnly?: boolean;
    android?: {
        priority: "high" | "normal";
        notification?: {
            sound: string;
            channelId: string;
            priority?: "min" | "low" | "default" | "high" | "max";
            visibility?: "private" | "public" | "secret";
            notificationCount?: number;
            defaultVibrateTimings?: boolean;
            defaultLightSettings?: boolean;
            click_action?: string;
        };
    };
    apns?: {
        headers?: Record<string, string>;
        payload: {
            aps: {
                alert: {
                    title: string;
                    body: string;
                };
                badge?: number;
                sound: string;
                "mutable-content": number;
                category?: string;
            };
        };
    };
}

interface PushDispatchLogger {
    info(details: unknown, message: string): void;
    warn(details: unknown, message: string): void;
    error(details: unknown, message: string): void;
}

export interface PushDispatchRequest {
    app: App;
    query: QueryFn;
    tokens: string[];
    payload: PushPayload;
    collapseKey: string;
    logger: PushDispatchLogger;
}

const INVALID_TOKEN_ERRORS = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
]);

/**
 * Shared FCM transport boundary. Payload construction remains with the calling
 * service; this module owns multicast shaping, delivery accounting, and stale
 * token cleanup for every notification kind.
 */
export async function dispatchPushNotifications(
    request: PushDispatchRequest,
): Promise<{ succeeded: number; failed: number }> {
    const { app, query, tokens, payload, collapseKey, logger } = request;
    let succeeded = 0;
    let failed = 0;

    try {
        const includeTopLevelNotification =
            !!payload.notification && !payload.androidDataOnly;
        const response = await getMessaging(app).sendEachForMulticast({
            tokens,
            ...(includeTopLevelNotification
                ? { notification: payload.notification }
                : {}),
            data: payload.data,
            android: payload.android,
            apns: payload.apns,
            webpush: {
                data: payload.data,
                ...(payload.notification
                    ? {
                          notification: {
                              title: payload.notification.title,
                              body: payload.notification.body,
                              icon: "/icon-192.png",
                          },
                      }
                    : {}),
            },
        });

        const invalidTokens: string[] = [];
        response.responses.forEach((item: SendResponse, index: number) => {
            if (item.success) {
                succeeded++;
                return;
            }

            failed++;
            if (item.error?.code && INVALID_TOKEN_ERRORS.has(item.error.code)) {
                invalidTokens.push(tokens[index]);
            }
        });

        if (invalidTokens.length > 0) {
            query(
                "DELETE FROM device_tokens WHERE device_token = ANY($1)",
                [invalidTokens],
            ).catch((err: any) => {
                logger.warn(
                    { err: err.message, count: invalidTokens.length },
                    "Failed to purge invalid device tokens",
                );
            });
        }

        logger.info(
            {
                event: "push_dispatch_result",
                collapseKey,
                notificationType: payload.data.type || (payload.data.callId ? "call" : "notification"),
                tenantId: payload.data.tenantId || null,
                dedupeKey: payload.data.dedupeKey || null,
                channelId: payload.android?.notification?.channelId,
                tokenCount: tokens.length,
                sent: response.successCount,
                failed: response.failureCount,
            },
            "Push notifications sent",
        );
    } catch (err) {
        logger.error(
            {
                event: "push_dispatch_failed",
                err: (err as Error).message,
                collapseKey,
                notificationType: payload.data.type || (payload.data.callId ? "call" : "notification"),
                tenantId: payload.data.tenantId || null,
                dedupeKey: payload.data.dedupeKey || null,
                channelId: payload.android?.notification?.channelId,
                tokenCount: tokens.length,
            },
            "Failed to send push notifications",
        );
        failed = tokens.length;
    }

    return { succeeded, failed };
}
