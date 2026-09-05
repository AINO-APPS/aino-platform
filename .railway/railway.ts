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
    NODE_ENV: "development",
    PORT: "5000",
    // Railway resolves these references without exposing credentials in source.
    // First deployment connects directly to fresh Postgres. PgBouncer remains
    // provisioned for a later one-role-at-a-time canary after smoke testing.
    DATABASE_URL: Postgres.env.DATABASE_URL,
    DIRECT_DATABASE_URL: Postgres.env.DATABASE_URL,
    REDIS_URL: Redis.env.REDIS_URL,
    STORAGE_DRIVER: "local",
    DISABLE_PUBLIC_TURN: "true",
    CORS_ORIGIN: "",
    // Created out-of-band with cryptographic randomness and retained without
    // decrypting or serializing their values into the IaC graph.
    JWT_SECRET: preserve(),
    ENCRYPTION_KEY: preserve(),
    DESKTOP_UPLOAD_SECRET: preserve(),
    METRICS_TOKEN: preserve(),
    // Empty optional integrations prevent email, push, TURN, R2, and API calls.
    CLOUDFLARE_TURN_API_TOKEN: "",
    CLOUDFLARE_TURN_TOKEN_ID: "",
    FIREBASE_SERVICE_ACCOUNT_KEY: "",
    GIPHY_API_KEY: "",
    GMAIL_CLIENT_ID: "",
    GMAIL_CLIENT_SECRET: "",
    GMAIL_REFRESH_TOKEN: "",
    GOOGLE_API_KEY: "",
    R2_ACCESS_KEY_ID: "",
    R2_ACCOUNT_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_UPLOADS_BUCKET: "",
    SMTP_FROM: "",
    SMTP_HOST: "",
    SMTP_PASS: "",
    SMTP_USER: "",
  };

  const appService = (name: string, role: "web" | "realtime" | "worker" | "all") =>
    service(name, {
      // MIG-0402: every application service uses only the split repository.
      source: github(SOURCE, { branch: BRANCH }),
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