/**
 * Firebase Cloud Messaging service for push notifications.
 * Manages FCM integration for calls, messages, and notifications.
 */

import type { App } from "firebase-admin/app";
import { logger } from "../utils/logger";
import type { QueryFn } from "../types/domain";
import {
    dispatchPushNotifications,
    type PushPayload as FCMPayload,
} from "../platform/pushNotifications/dispatch";
import {
    assertRoutingPayloadContract,
    buildCommonPushData,
} from "../platform/pushNotifications/payloadContract";
import {
    getDeviceTokens,
    registerDeviceToken,
} from "../platform/pushNotifications/deviceTokens";
import { initializePushFirebaseApp } from "../platform/pushNotifications/firebaseApp";

class PushNotificationService {
    private initialized = false;
    private app: App | null = null;

    constructor() {
        this.initialize();
    }

    private initialize() {
        this.app = initializePushFirebaseApp(logger);
        this.initialized = this.app !== null;
    }

    async registerDeviceToken(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
        deviceToken: string,
        platform: "ios" | "android",
    ): Promise<void> {
        return registerDeviceToken(
            query,
            userId,
            tenantId,
            deviceToken,
            platform,
            logger,
        );
    }

    async sendCallNotification(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
        callData: {
            callId: number;
            conversationId: number;
            callerId: number;
            callerName: string;
            callerAvatar?: string;
            callType: "voice" | "video";
            isGroup?: boolean;
            groupName?: string;
            // Group CALL (huddle) join code. When present the callee joins the
            // n-way meeting mesh via this code instead of the 1:1 p2p flow.
            meetingCode?: string;
        },
    ): Promise<{ succeeded: number; failed: number }> {
        if (!this.initialized || !this.app) {
            return { succeeded: 0, failed: 0 };
        }

        const tokens = await this.getDeviceTokens(query, userId, tenantId);
        if (tokens.length === 0) {
            // info (not debug) so this is visible in production. The #1 cause of
            // "push never shows" is the recipient simply having no registered
            // device token (registration failed, table missing, or never logged
            // in on a build with FCM). Surfacing it here makes that obvious.
            logger.info({ event: "push_skip_no_tokens", notificationType: "call", userId, tenantId, callId: callData.callId }, "No device tokens for call notification recipient");
            return { succeeded: 0, failed: 0 };
        }

        // T050: Fetch user's notification prefs to check if sensitive content should be hidden
        let hideSensitiveContent = false;
        try {
            const prefRow = (await query(
                "SELECT notification_prefs FROM users WHERE id = $1",
                [userId],
            )).rows[0];
            const prefs = prefRow?.notification_prefs || {};
            hideSensitiveContent = Boolean(prefs.hideSensitiveContent);
        } catch (err) {
            logger.warn({ err: (err as Error).message, userId }, "Failed to fetch notification prefs; defaulting hideSensitiveContent to false");
        }

        // When hideSensitiveContent is true, show generic content on lock screen
        const displayName = hideSensitiveContent ? "Incoming call" : callData.callerName;
        const title = callData.callType === "video" ? "Incoming Video Call" : "Incoming Voice Call";
        const body = hideSensitiveContent ? "Tap to answer" : `${callData.callerName} is calling...`;
        const callTTLSeconds = Number(process.env.PUSH_CALL_TTL_SECONDS || 30);

        // IMPORTANT: Incoming-call pushes are DATA-ONLY (no top-level
        // `notification` block). On Android, a message that contains a
        // `notification` block is treated as a "notification message" and is
        // rendered by the OS without invoking the app's background message
        // handler when the app is killed. Our headless handler is exactly what
        // calls CallKeep.displayIncomingCall() to show the native full-screen
        // call UI, so the payload MUST be data-only to guarantee it fires in the
        // terminated state. Title/body are carried in `data` for the client to
        // present the call screen.
        const payload: FCMPayload = {
            data: buildCommonPushData({
                type: "incoming_call",
                title,
                body,
                callId: String(callData.callId),
                conversationId: String(callData.conversationId),
                callerId: String(callData.callerId),
                // Omit sensitive data (caller name/avatar) if hideSensitiveContent is true
                ...(hideSensitiveContent ? {} : {
                    callerName: callData.callerName || "",
                    callerAvatar: callData.callerAvatar || "",
                }),
                callType: callData.callType,
                isGroup: String(callData.isGroup || false),
                groupName: callData.groupName || "",
                meetingCode: callData.meetingCode || "",
                expiresAt: new Date(Date.now() + (callTTLSeconds * 1000)).toISOString(),
                dedupeKey: `call:${callData.callId}`,
                callCategory: "incoming-call",
            }, tenantId),
            // Android: high-priority DATA-ONLY message wakes the RN Firebase
            // headless JS handler. Do not include `android.notification` here:
            // the mobile app/Notifee must render the full-screen call UI itself.
            android: {
                priority: "high",
            },
            // iOS: use a high-priority alert/VoIP push so the handler runs and
            // CallKit can present the incoming-call UI.
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": process.env.PUSH_CALL_APNS_PUSH_TYPE || "alert",
                },
                payload: {
                    aps: {
                        alert: { title, body },
                        badge: 1,
                        sound: "default",
                        "mutable-content": 1,
                        category: "incoming-call",
                    },
                },
            },
        };
        assertRoutingPayloadContract("call", payload.data, logger);

        logger.info(
            {
                event: "push_dispatch_attempt",
                notificationType: "call",
                tenantId,
                userId,
                callId: callData.callId,
                conversationId: callData.conversationId,
                dedupeKey: payload.data.dedupeKey,
                channelId: payload.android?.notification?.channelId || payload.data.callCategory || "calls",
                tokenCount: tokens.length,
            },
            "Dispatching call notification push",
        );

        // P2.12 — Push send verification + WS fallback.
        // The WS `call_incoming` event (emitted by the call_initiate handler in
        // server/utils/ws.ts BEFORE this push is dispatched) is the GUARANTEED
        // fallback for any callee device that already has a live socket. This
        // push only matters for backgrounded/locked/killed devices that the WS
        // event can't wake. So when EVERY token fails (succeeded === 0 despite
        // having tokens), it means the only delivery path for an
        // offline/backgrounded device just failed — we log a STRUCTURED error
        // (so it's alertable) and attempt ONE retry before giving up. A live
        // device will still ring via the WS event regardless of this outcome.
        let result = await this.sendToDevices(query, tokens, payload, `call-${callData.callId}`);

        if (result.succeeded === 0) {
            logger.error(
                {
                    event: "push_call_all_failed",
                    notificationType: "call",
                    tenantId,
                    userId,
                    callId: callData.callId,
                    conversationId: callData.conversationId,
                    dedupeKey: payload.data.dedupeKey,
                    tokenCount: tokens.length,
                    failed: result.failed,
                    note: "WS call_incoming remains the alive-device fallback; retrying push once",
                },
                "Call push notification failed for ALL device tokens — retrying once",
            );

            // Optional single retry. Re-fetch tokens in case invalid ones were
            // purged by the failed attempt; if none remain there is nothing to
            // retry (the WS event still covers any live device).
            const retryTokens = await this.getDeviceTokens(query, userId, tenantId);
            if (retryTokens.length > 0) {
                const retryResult = await this.sendToDevices(query, retryTokens, payload, `call-${callData.callId}-retry`);
                result = {
                    succeeded: retryResult.succeeded,
                    failed: retryResult.failed,
                };
                if (retryResult.succeeded === 0) {
                    logger.error(
                        {
                            event: "push_call_retry_failed",
                            notificationType: "call",
                            tenantId,
                            userId,
                            callId: callData.callId,
                            conversationId: callData.conversationId,
                            dedupeKey: payload.data.dedupeKey,
                            tokenCount: retryTokens.length,
                            failed: retryResult.failed,
                            note: "WS call_incoming remains the alive-device fallback",
                        },
                        "Call push notification retry also failed for ALL device tokens",
                    );
                }
            }
        }

        return result;
    }

    /**
     * Send a DATA-ONLY high-priority "call handled elsewhere" push so a twin
     * device (locked/backgrounded) stops ringing once the call is
     * accepted/rejected/cancelled on another device (or by the caller).
     *
     * The mobile background/headless handler watches for
     * `type === "call_handled_elsewhere"` and dismisses the active incoming-call
     * UI (Notifee/CallKeep) for the matching `callId`.
     */
    async sendCallCancellation(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
        cancelData: {
            callId: number;
            conversationId: number;
            reason?: string;
        },
    ): Promise<{ succeeded: number; failed: number }> {
        if (!this.initialized || !this.app) {
            return { succeeded: 0, failed: 0 };
        }

        const tokens = await this.getDeviceTokens(query, userId, tenantId);
        if (tokens.length === 0) {
            logger.info(
                { event: "push_skip_no_tokens", notificationType: "call_cancel", userId, tenantId, callId: cancelData.callId },
                "No device tokens for call cancellation recipient",
            );
            return { succeeded: 0, failed: 0 };
        }

        // DATA-ONLY high-priority message — wakes the background/headless handler
        // so it can dismiss the active ring. No `notification` block on Android.
        const payload: FCMPayload = {
            data: buildCommonPushData({
                type: "call_handled_elsewhere",
                callId: String(cancelData.callId),
                conversationId: String(cancelData.conversationId),
                reason: cancelData.reason || "handled_elsewhere",
                dedupeKey: `call_cancel:${cancelData.callId}`,
            }, tenantId),
            android: {
                priority: "high",
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "background",
                },
                payload: {
                    aps: {
                        // Background/silent push so CallKit/JS can dismiss the call.
                        alert: { title: "", body: "" },
                        sound: "",
                        "mutable-content": 1,
                    },
                },
            },
        };
        // ROOT-CAUSE FIX ("receiver keeps ringing after the caller hung up"):
        // this previously asserted the "message" (chat) contract against a
        // call-teardown payload, which can NEVER satisfy it (no messageId /
        // senderId / senderName, type is `call_handled_elsewhere`, dedupeKey is
        // `call_cancel:<id>`). The assert therefore threw on EVERY invocation,
        // before sendToDevices was reached, so the dismissal push was never
        // delivered. Every one of the 14 call sites swallows the rejection in a
        // `.catch()` that only logs at warn level, so this failed silently.
        //
        // Consequence: when the caller hung up (or the callee answered on
        // another device), a BACKGROUNDED/LOCKED/KILLED callee never got the
        // dismiss signal. Android freezes the JS thread + WebSocket while
        // backgrounded, so the WS `call_ended` frame cannot reach it either —
        // this push is the ONLY teardown path in that state. The native ring
        // kept playing until the Notifee 45s timeout / stale-call sweep.
        //
        // The contract is now the correct `call_cancel` variant AND is
        // non-fatal: dismissing a live ring is strictly more important than
        // payload purity, so a future contract drift can never again silently
        // leave a device ringing. We log loudly and still dispatch.
        try {
            assertRoutingPayloadContract("call_cancel", payload.data, logger);
        } catch (err: any) {
            logger.error(
                {
                    event: "push_contract_violation",
                    notificationType: "call_cancel",
                    err: err?.message,
                    callId: cancelData.callId,
                    conversationId: cancelData.conversationId,
                },
                "Call-cancellation push failed contract validation; dispatching anyway to guarantee ring teardown",
            );
        }

        logger.info(
            {
                event: "push_dispatch_attempt",
                notificationType: "call_cancel",
                tenantId,
                userId,
                callId: cancelData.callId,
                conversationId: cancelData.conversationId,
                reason: cancelData.reason,
                dedupeKey: payload.data.dedupeKey,
                tokenCount: tokens.length,
            },
            "Dispatching call cancellation push",
        );

        return this.sendToDevices(query, tokens, payload, `call-cancel-${cancelData.callId}`);
    }

    async sendMessageNotification(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
        messageData: {
            conversationId: number;
            messageId: number;
            senderId: number;
            senderName: string;
            senderAvatar?: string;
            isGroup?: boolean;
            groupName?: string;
            messagePreview: string;
            unreadCount?: number; // T031: Server-authoritative unread count
        },
    ): Promise<{ succeeded: number; failed: number }> {
        if (!this.initialized || !this.app) {
            return { succeeded: 0, failed: 0 };
        }

        const tokens = await this.getDeviceTokens(query, userId, tenantId);
        if (tokens.length === 0) {
            logger.info({ event: "push_skip_no_tokens", notificationType: "message", userId, tenantId, messageId: messageData.messageId }, "No device tokens for message notification recipient");
            return { succeeded: 0, failed: 0 };
        }

        const preview = messageData.messagePreview.substring(0, 150);
        const unreadCount = messageData.unreadCount || 1;
    const isGroup = Boolean(messageData.isGroup);
    const groupName = (messageData.groupName || "").trim();
    const notificationTitle = isGroup ? groupName || "Group" : messageData.senderName;
    const notificationBody = isGroup ? `${messageData.senderName}: ${preview}` : preview;

        // ANDROID DATA-ONLY (messages): chat messages are sent DATA-ONLY on
        // Android (no top-level `notification` block, no `android.notification`)
        // — exactly like CALLS — so the app's background/headless handler ALWAYS
        // runs and renders the notification itself via Notifee. This is the ONLY
        // way to attach the sender's CIRCULAR avatar as the notification
        // largeIcon: the avatar lives behind the server's `/uploads` auth
        // middleware, so it must be downloaded WITH a Bearer token (which an
        // OS-rendered FCM `notification` message cannot do) and clipped to a
        // circle. Previously messages used a HYBRID payload (top-level
        // `notification` + `android.notification`), which made Android render the
        // message itself and BYPASS the headless handler — so the avatar never
        // showed (calls always showed it because they were data-only). We keep
        // `androidDataOnly` so sendToDevices omits the top-level `notification`
        // from the Android multicast; the webpush notification (desktop/browser)
        // and the iOS APNs alert are still rendered. In every Android state
        // (foreground via onMessage, background/killed via the headless task) the
        // handler calls notifeeService.displayMessage, which fetches the authed
        // avatar and posts it as a circular largeIcon.
        const payload: FCMPayload = {
            // Used ONLY for the webpush (desktop/browser) notification render —
            // NOT applied to the Android multicast because androidDataOnly is set
            // below (see sendToDevices).
            notification: {
                title: notificationTitle,
                body: notificationBody,
            },
            androidDataOnly: true,
            data: buildCommonPushData({
                type: "chat_message",
                title: notificationTitle,
                body: preview,
                conversationId: String(messageData.conversationId),
                messageId: String(messageData.messageId),
                senderId: String(messageData.senderId),
                senderName: messageData.senderName,
                isGroup: String(isGroup),
                groupName,
                // Carry the sender's avatar so the mobile client can render it as
                // the notification largeIcon (chat-avatar parity with calls, which
                // already send callerAvatar). Empty string when the sender has no
                // avatar — the client falls back to the app icon.
                senderAvatar: messageData.senderAvatar || "",
                unreadCount: String(unreadCount),
                badgeCount: String(unreadCount),
                dedupeKey: `msg:${messageData.messageId}`,
                // T031: Add expiry for payload freshness validation (1 hour TTL)
                expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
            }, tenantId),
            // Android: high-priority DATA-ONLY message (no `android.notification`)
            // so the RN Firebase headless/background handler runs and renders the
            // message via Notifee with the sender's circular avatar largeIcon.
            android: {
                priority: "high",
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "alert",
                },
                payload: {
                    aps: {
                        alert: {
                            title: notificationTitle,
                            body: notificationBody,
                        },
                        badge: unreadCount,
                        sound: "default",
                        "mutable-content": 1,
                    },
                },
            },
        };

        logger.info(
            {
                event: "push_dispatch_attempt",
                notificationType: "message",
                tenantId,
                userId,
                conversationId: messageData.conversationId,
                messageId: messageData.messageId,
                unreadCount,
                dedupeKey: payload.data.dedupeKey,
                channelId: payload.android?.notification?.channelId || "messages",
                recipientCount: tokens.length,
            },
            "Dispatching message notification push",
        );

        return this.sendToDevices(query, tokens, payload, `msg-${messageData.messageId}`);
    }

    async sendNotificationAlert(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
        notificationData: {
            notificationId: number;
            title: string;
            body: string;
            type?: string;
            // Server-authoritative total unread/alert count for the launcher
            // badge (defaults to 1 when omitted).
            badgeCount?: number;
            // Optional avatar of the user who triggered this alert (the "actor"
            // — e.g. the assigner of a task, the approver of a leave request).
            // When present the mobile client renders it as the notification's
            // circular largeIcon (chat-avatar parity); when absent the client
            // falls back to the org branding logo, and the app-logo silhouette
            // is always the status-bar smallIcon.
            actorAvatar?: string;
            actorName?: string;
        },
    ): Promise<{ succeeded: number; failed: number }> {
        if (!this.initialized || !this.app) {
            return { succeeded: 0, failed: 0 };
        }

        const tokens = await this.getDeviceTokens(query, userId, tenantId);
        if (tokens.length === 0) {
            logger.info({ event: "push_skip_no_tokens", notificationType: "notification", userId, tenantId, notificationId: notificationData.notificationId }, "No device tokens for alert notification recipient");
            return { succeeded: 0, failed: 0 };
        }

        // IMPORTANT: Like message pushes, alert pushes are DATA-ONLY on Android
        // (no top-level `notification` block and no `android.notification`). A
        // payload containing a `notification` block is handed straight to the
        // Android system tray and does NOT invoke the app's background/headless
        // message handler when backgrounded/killed, and is NOT auto-displayed by
        // RN Firebase's `onMessage` in the foreground — so foreground alerts were
        // silently dropped and the headless path was bypassed. Routing alerts
        // through `data` makes the app's handler post them via Notifee in all
        // states (foreground/background/killed). Title/body travel in `data`.
        // The webpush.notification block (added in sendToDevices) still renders
        // the browser/desktop alert. iOS keeps its visible APNs alert below.
        const badge = notificationData.badgeCount ?? 1;
        const payload: FCMPayload = {
            data: buildCommonPushData({
                notificationId: String(notificationData.notificationId),
                type: notificationData.type || "notification",
                title: notificationData.title,
                body: notificationData.body,
                badgeCount: String(badge),
                dedupeKey: `notif:${notificationData.notificationId}`,
                // Carry the actor's avatar/name so the mobile client can render
                // the triggering user's circular avatar as the notification
                // largeIcon (chat-avatar parity). Empty when there is no actor —
                // the client then falls back to the org branding logo, and the
                // app-logo silhouette is always the status-bar smallIcon.
                actorAvatar: notificationData.actorAvatar || "",
                actorName: notificationData.actorName || "",
            }, tenantId),
            // Keep webpush rendering via the optional notification block below by
            // exposing title/body to sendToDevices.
            notification: {
                title: notificationData.title,
                body: notificationData.body,
            },
            android: {
                priority: "high",
            },
            apns: {
                headers: {
                    "apns-priority": "10",
                    "apns-push-type": "alert",
                },
                payload: {
                    aps: {
                        alert: {
                            title: notificationData.title,
                            body: notificationData.body,
                        },
                        badge,
                        sound: "default",
                        "mutable-content": 1,
                    },
                },
            },
        };

        return this.sendToDevices(query, tokens, payload, `notif-${notificationData.notificationId}`);
    }

    private async getDeviceTokens(
        query: QueryFn,
        userId: number,
        tenantId: number | null,
    ): Promise<string[]> {
        return getDeviceTokens(query, userId, tenantId, logger);
    }

    private async sendToDevices(
        query: QueryFn,
        tokens: string[],
        payload: FCMPayload,
        collapseKey: string,
    ): Promise<{ succeeded: number; failed: number }> {
        if (!this.app) {
            return { succeeded: 0, failed: 0 };
        }

        return dispatchPushNotifications({
            app: this.app,
            query,
            tokens,
            payload,
            collapseKey,
            logger,
        });
    }
}

export const pushNotifications = new PushNotificationService();
