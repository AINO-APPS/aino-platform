/**
 * A throwaway database per PostgreSQL test suite.
 *
 * Production gives every tenant its own database (ADR-001), and the tenant
 * schema's idempotence checks rely on it: they look up constraints by name in
 * `information_schema` without a schema filter. Suites that shared one
 * database through separate schemas saw each other's constraints and skipped
 * creating their own. One database per suite keeps the test model honest.

 */
import crypto from "crypto";
import { Pool } from "pg";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "postgres"];

/** Refuse anything but a local database whose name says it is for tests. */
export function assertLocalTestUrl(url: string): URL {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.slice(1));
    if (!LOCAL_HOSTS.includes(parsed.hostname) || !name.toLowerCase().includes("test")) {
        throw new Error("TASKS_SCHEMA_TEST_DATABASE_URL must point to a local database whose name includes 'test'");
    }
    return parsed;
}

/** Create a fresh database next to `baseUrl`; `drop()` removes it. */
export async function createTestDatabase(baseUrl: string, label: string): Promise<{ url: string; drop: () => Promise<void> }> {
    const base = assertLocalTestUrl(baseUrl);
    const name = `${label}_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new Pool({ connectionString: baseUrl, max: 1 });
    try {
        await admin.query(`CREATE DATABASE ${name}`);
    } finally {
        await admin.end();
    }
    const target = new URL(base.toString());
    target.pathname = `/${name}`;
    return {
        url: target.toString(),
        drop: async () => {
            const cleanup = new Pool({ connectionString: baseUrl, max: 1 });
            try {
                await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
            } finally {
                await cleanup.end();
            }
        },
    };
}
