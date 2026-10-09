/**
 * Complete HTTP route map.
 *
 * This is the one place a developer looks to answer "where is /api/x
 * mounted?". Route modules remain unchanged; Phase G moves their internals
 * behind service/repository layers.
 */
import type { Express } from "express";
import type { RateLimiters } from "./middleware/rateLimits";
import authRoutes from "../routes/auth";
import sessionsRoutes from "../routes/sessions";
import mfaRoutes from "../routes/mfa";
import { requireRecentMfa } from "../middleware/requireRecentMfa";
import trackerRoutes from "../routes/tracker";
import leaveRoutes from "../routes/leaves";
import taskRoutes from "../routes/tasks";
import profileRoutes from "../routes/profile";
import organizationRoutes from "../routes/organization";
import adminRoutes from "../routes/admin";
import internalRoutes from "../routes/internal";
import managerRoutes from "../routes/manager";
import leavePolicyRoutes from "../routes/leavePolicy";
import sprintsRoutes from "../routes/sprints";
import agileRoutes from "../routes/agile";
import notesRoutes from "../routes/notes";
import calendarRoutes from "../routes/calendar";
import notificationsRoutes from "../routes/notifications";
import exportRoutes from "../routes/export";
import chatRoutes from "../routes/chat";
import statusRoutes from "../routes/status";
import searchRoutes from "../routes/search";
import meetingsRoutes from "../routes/meetings";
import tenantRoutes from "../routes/tenants";
import platformAccessRoutes from "../routes/platformAccess";
import serviceDeskRoutes from "../routes/serviceDesk";
import brandingRoutes from "../routes/branding";
import customFieldsRoutes from "../routes/customFields";
import publicRoutes from "../routes/public";
import compensationRoutes from "../routes/compensation";
import webhookRoutes from "../routes/webhooks";
import projectsRoutes from "../routes/projects";
import integrationsRoutes from "../routes/integrations";
import impersonationAudit from "../middleware/impersonationAudit";
import { maintenanceModeMiddleware } from "../middleware/maintenanceMode";
import { webOnly, webOnlyExcept } from "../middleware/webOnly";

// Legacy JavaScript-style module.exports (the only route module without a
// TypeScript `export =`), so a default import has no declared export shape.
const giphyRoutes = require("../routes/giphy");

/** External webhooks MUST be mounted before the CSRF middleware. */
function mountWebhookRoutes(app: Express): void {
    app.use("/api/webhooks", webhookRoutes);
}

/** Mount all normal API routes in their established order. */
function mountApiRoutes(app: Express, limiters: RateLimiters): void {
    const {
        authLimiter,
        registerLimiter,
        forgotPasswordLimiter,
        passwordLimiter,
        apiLimiter,
    } = limiters;

    app.use("/api", impersonationAudit);
    app.use("/api", maintenanceModeMiddleware);

    app.use("/api/auth/register", registerLimiter);
    app.use("/api/auth/forgot-password", forgotPasswordLimiter);
    app.use("/api/auth/biometric/login", authLimiter);
    app.use("/api/auth/mfa", authLimiter, mfaRoutes);
    app.use("/api/auth", authLimiter, authRoutes);
    app.use("/api/sessions", apiLimiter, sessionsRoutes);
    app.use("/api/tracker", apiLimiter, trackerRoutes);
    app.use("/api/leaves", apiLimiter, leaveRoutes);
    app.use("/api/tasks", apiLimiter, taskRoutes);
    app.use("/api/sprints", apiLimiter, sprintsRoutes);
    // Agile editor routes are gated in middleware/agileEditor.ts; the
    // reviewer inbox (access requests / grants) is gated here.
    app.use("/api/agile", apiLimiter, webOnlyExcept((req) => !/^\/permissions\/(requests|grants)(\/|$)/.test(req.path)), agileRoutes);
    app.use("/api/profile/password", passwordLimiter);
    app.use("/api/profile", apiLimiter, profileRoutes);
    // Organization-page structure edits (departments / teams) stay on the app;
    // the Admin → My Organization operations below are web-only.
    app.use("/api/org", apiLimiter, webOnlyExcept((req) => !(
        (req.method === "PUT" && req.path === "/settings")
        || (req.method === "POST" && (req.path === "/invite" || req.path === "/remove-member"))
        || (req.method !== "GET" && req.path.startsWith("/roles"))
    )), organizationRoutes);
    // Mount the more-specific master/platform router first. The general admin
    // router has router-wide requireTenant middleware and would otherwise
    // intercept /api/admin/tenants/* with "Organization context required".
    // Administration is web-only: the native app's tokens are refused here
    // (middleware/webOnly.ts). Self-service reads it still needs are exempt.
    // P2.1: changes made through these routers need a recent second factor (step-up).
    app.use("/api/admin/tenants", apiLimiter, webOnly, requireRecentMfa, tenantRoutes);
    app.use("/api/admin", apiLimiter, webOnly, requireRecentMfa, adminRoutes);
    app.use("/api/platform-access", apiLimiter, webOnly, requireRecentMfa, platformAccessRoutes);
    app.use("/api/internal", apiLimiter, webOnly, internalRoutes);
    app.use("/api/manager", apiLimiter, managerRoutes);
    app.use("/api/leave-policy", apiLimiter, leavePolicyRoutes);
    app.use("/api/notes", apiLimiter, notesRoutes);
    app.use("/api/calendar", apiLimiter, calendarRoutes);
    app.use("/api/meetings", apiLimiter, meetingsRoutes);
    app.use("/api/notifications", apiLimiter, notificationsRoutes);
    app.use("/api/export", apiLimiter, exportRoutes);
    app.use("/api/chat", apiLimiter, chatRoutes);
    app.use("/api/giphy", apiLimiter, giphyRoutes);
    app.use("/api/me/status", apiLimiter, statusRoutes);
    app.use("/api/search", apiLimiter, searchRoutes);
    app.use("/api/service-desk", apiLimiter, serviceDeskRoutes);
    app.use("/api/branding", apiLimiter, webOnlyExcept((req) => req.method === "GET" && req.path === "/"), brandingRoutes);
    app.use("/api/custom-fields", apiLimiter, customFieldsRoutes);
    app.use("/api/compensation", apiLimiter, webOnlyExcept((req) => req.path.startsWith("/my-")), compensationRoutes);
    app.use("/api/projects", apiLimiter, webOnlyExcept((req) => req.method === "GET"), projectsRoutes);
    app.use("/api/integrations", apiLimiter, integrationsRoutes);
    app.use("/api/public", apiLimiter, publicRoutes);
}

export { mountWebhookRoutes, mountApiRoutes };