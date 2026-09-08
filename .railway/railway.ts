import { defineRailway, github, image, postgres, preserve, project, redis, service } from "railway/iac";

// Preserve the region of the already-provisioned fresh data services. Changing
// this value would trigger a destructive database/volume move.
const REGION = "europe-west4-drams3a";
const SOURCE = "AINO-APPS/aino-platform";
const BRANCH = "master";

export default defineRailway(() => {
  // MIG-0401: these resources are created inside the new, isolated project.
  const Postgres = postgres("Postgres", { region: REGION });
  const Redis = redis("Redis", { region: REGION });

  const PgBouncer = service("PgBouncer", {
    source: image("edoburu/pgbouncer:v1.24.1-p1"),
    env: {
      DB_HOST: Postgres.env.PGHOST,
      DB_PORT: Postgres.env.PGPORT,
      DB_USER: Postgres.env.PGUSER,
      DB_PASSWORD: Postgres.env.PGPASSWORD,
      DB_NAME: Postgres.env.PGDATABASE,
      POOL_MODE: "transaction",
      DEFAULT_POOL_SIZE: "20",
      MIN_POOL_SIZE: "0",
      RESERVE_POOL_SIZE: "5",
      MAX_CLIENT_CONN: "500",
      MAX_DB_CONNECTIONS: "80",
      LISTEN_PORT: "5432",
      SERVER_TLS_SSLMODE: "prefer",
      IGNORE_STARTUP_PARAMETERS: "extra_float_digits,options",
    },
    // No service domain or TCP proxy: PgBouncer is private-only.
    networking: { privateNetworkEndpoint: "pgbouncer" },
  });

  const commonEnv = {
    // Production posture. `development` disabled real hardening: no HSTS,
    // non-Secure auth cookies, localhost accepted as a CORS origin, an open
    // /metrics when no token is set, and — most damaging on a multi-replica
    // deployment — a silent BullMQ fallback to per-process setInterval, so
    // every scheduled job would run once per replica.
    NODE_ENV: "production",
    PORT: "5000",
    // Required in production by bootstrap/env.ts: HTTPS-only cookies are gated
    // on this in addition to NODE_ENV, so omitting it leaves `secure: false`.
    USE_HTTPS: "true",
    // Railway resolves these references without exposing credentials in source.
    // First deployment connects directly to fresh Postgres. PgBouncer remains
    // provisioned for a later one-role-at-a-time canary after smoke testing.
    DATABASE_URL: Postgres.env.DATABASE_URL,
    DIRECT_DATABASE_URL: Postgres.env.DATABASE_URL,
    REDIS_URL: Redis.env.REDIS_URL,
    // Must be r2 whenever NODE_ENV=production: the container is stateless with
    // no mounted volume, so local uploads vanish on redeploy and are invisible
    // to the other replicas. assertProductionStorage() refuses to boot on
    // STORAGE_DRIVER=local in production, so these two move together.
    STORAGE_DRIVER: "r2",
    DISABLE_PUBLIC_TURN: "true",
    // Created out-of-band and retained without decrypting or serializing their
    // values into the IaC graph. `preserve()` is also used for every operator-
    // supplied integration credential below: hardcoding "" here would silently
    // WIPE values already configured in Railway on the next apply.
    JWT_SECRET: preserve(),
    ENCRYPTION_KEY: preserve(),
    DESKTOP_UPLOAD_SECRET: preserve(),
    METRICS_TOKEN: preserve(),
    CORS_ORIGIN: preserve(),
    CLOUDFLARE_TURN_API_TOKEN: preserve(),
    CLOUDFLARE_TURN_TOKEN_ID: preserve(),
    FIREBASE_SERVICE_ACCOUNT_KEY: preserve(),
    GIPHY_API_KEY: preserve(),
    GMAIL_CLIENT_ID: preserve(),
    GMAIL_CLIENT_SECRET: preserve(),
    GMAIL_REFRESH_TOKEN: preserve(),
    GOOGLE_API_KEY: preserve(),
    R2_ACCESS_KEY_ID: preserve(),
    R2_ACCOUNT_ID: preserve(),
    R2_SECRET_ACCESS_KEY: preserve(),
    R2_UPLOADS_BUCKET: preserve(),
    SMTP_FROM: preserve(),
    SMTP_HOST: preserve(),
    SMTP_PASS: preserve(),
    SMTP_USER: preserve(),
  };

  const appService = (name: string, role: "web" | "realtime" | "worker" | "all") =>
    service(name, {
      // MIG-0402: every application service uses only the split repository.
      source: github(SOURCE, { branch: BRANCH, checkSuites: true }),
      healthcheck: "/readyz",
      healthcheckTimeout: 300,
      preDeployCommand: role === "web" ? ["node migrate.js"] : undefined,
      deploy: {
        restartPolicyType: "ON_FAILURE",
        restartPolicyMaxRetries: 10,
        overlapSeconds: 30,
        drainingSeconds: 15,
        // Railway requires at least one declared replica. Serverless sleep keeps
        // the private rollback target cold until an operator explicitly uses it.
        numReplicas: 1,
        sleepApplication: role === "all",
      },
      // MIG-0404: all services start private-only. In particular the worker and
      // rollback service have no public domain or TCP proxy to receive traffic.
      networking: { privateNetworkEndpoint: name },
      env: {
        ...commonEnv,
        ROLE: role,
        SERVE_SPA: role === "web" || role === "all" ? "true" : "false",
      },
    });

  // MIG-0403: role-split services plus an isolated ROLE=all rollback target.
  const web = appService("aino-next-web", "web");
  const realtime = appService("aino-next-realtime", "realtime");
  const worker = appService("aino-next-worker", "worker");
  const rollback = appService("aino-next-rollback", "all");

  return project("aino-platform-next", {
    resources: [Postgres, Redis, PgBouncer, web, realtime, worker, rollback],
  });
});