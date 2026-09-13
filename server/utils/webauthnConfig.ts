import type { Request } from "express";

export interface WebauthnConfig {
    rpID: string;
    rpName: string;
    origin: string;
}

/** Resolve WebAuthn relying-party settings from configuration or the request host. */
export function webauthnConfig(req: Request): WebauthnConfig {
    const envRpId = process.env.WEBAUTHN_RP_ID;
    const envOrigin = process.env.WEBAUTHN_ORIGIN || process.env.CORS_ORIGIN;
    const host = (req.headers.host || "localhost:5000").split(",")[0].trim();
    const hostname = host.split(":")[0];
    const proto = (req.headers["x-forwarded-proto"] as string) || (req.secure ? "https" : "http");
    return {
        rpID: envRpId || hostname,
        rpName: "AINO",
        origin: envOrigin ? envOrigin.split(",")[0].trim() : `${proto}://${host}`,
    };
}
