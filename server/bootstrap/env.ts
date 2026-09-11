import path from "path";
import fs from "fs";

/** Load server-local `.env` first, then fall back to the process cwd. */
function loadEnvironment(serverDir: string): void {
    const envPath = path.join(serverDir, ".env");
    if (fs.existsSync(envPath)) {
        require("dotenv").config({ path: envPath });
    } else {
        require("dotenv").config();
    }
}

/** Fail fast on configuration that would make authentication/storage unsafe. */
function validateEnvironment(): void {
    // Resolve after loadEnvironment() so logger.ts observes NODE_ENV/LOG_LEVEL
    // from the server-local .env rather than process defaults.
    const { logger } = require("../utils/logger");
    if (!process.env.JWT_SECRET) {
        logger.fatal("JWT_SECRET environment variable is not set. Server cannot start.");
        throw new Error("JWT_SECRET environment variable is not set");
    }
    if (process.env.NODE_ENV === "production" && process.env.JWT_SECRET.length < 32) {
        logger.fatal("JWT_SECRET must be at least 32 characters in production. Server cannot start.");
        throw new Error("JWT_SECRET must be at least 32 characters in production");
    }
    if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
        logger.fatal("REDIS_URL is required in production. Server cannot start.");
        throw new Error("REDIS_URL is required in production");
    }

    // ── Control-plane host (PR-B) ──
    // CONSOLE_HOST separates the Platform Console onto its own hostname, which
    // is what gives the two realms independent, host-scoped session cookies.
    // It is optional so existing single-host deployments keep working, but a
    // malformed value must fail loudly rather than silently disable the split.
    if (process.env.CONSOLE_HOST) {
        const host = process.env.CONSOLE_HOST.trim().toLowerCase();
        if (host.includes("/") || host.includes(":") || !/^[a-z0-9.-]+$/.test(host)) {
            logger.fatal(
                { CONSOLE_HOST: process.env.CONSOLE_HOST },
                "CONSOLE_HOST must be a bare hostname (no scheme, port or path). Server cannot start.",
            );
            throw new Error("CONSOLE_HOST must be a bare hostname");
        }
    } else if (process.env.NODE_ENV === "production") {
        logger.warn(
            "CONSOLE_HOST is not set — the platform console shares the application hostname. " +
            "Control-plane and tenant sessions are separated by JWT audience only, not by cookie scope.",
        );
    }

    // STRICT_REALM closes the grace window that accepts pre-PR-B tokens with no
    // `aud` claim. Flip it once aino_legacy_realmless_token_total reaches zero.
    if (process.env.STRICT_REALM && !["true", "false"].includes(process.env.STRICT_REALM)) {
        logger.fatal({ STRICT_REALM: process.env.STRICT_REALM }, "STRICT_REALM must be 'true' or 'false'.");
        throw new Error("STRICT_REALM must be 'true' or 'false'");
    }

    // Local disk cannot be shared between replicas. Surface this at boot rather
    // than after one instance writes a file another cannot see.
    if (process.env.NODE_ENV !== "test") {
        const { assertProductionStorage } = require("../platform/storage");
        assertProductionStorage();
    }
}

export { loadEnvironment, validateEnvironment };