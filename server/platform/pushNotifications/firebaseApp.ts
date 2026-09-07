import { initializeApp, cert, type App } from "firebase-admin/app";

interface FirebaseAppLogger {
    info(details: unknown, message: string): void;
    warn(message: string): void;
    error(details: unknown, message: string): void;
}

export function initializePushFirebaseApp(logger: FirebaseAppLogger): App | null {
    try {
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!serviceAccountKey) {
            logger.warn("FIREBASE_SERVICE_ACCOUNT_KEY not configured — push notifications disabled");
            return null;
        }

        const serviceAccount = JSON.parse(serviceAccountKey);
        const app = initializeApp({
            credential: cert(serviceAccount),
        }, "aino");
        logger.info(
            {
                projectId: serviceAccount.project_id || "unknown",
                clientEmail: serviceAccount.client_email || "unknown",
            },
            "Firebase Cloud Messaging initialized",
        );
        return app;
    } catch (err) {
        logger.error({ err: (err as Error).message }, "Failed to initialize Firebase");
        return null;
    }
}
