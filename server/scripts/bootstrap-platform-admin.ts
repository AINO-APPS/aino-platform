#!/usr/bin/env node
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { BCRYPT_ROUNDS, validatePassword } from "../utils/password";

const BOOTSTRAP_USERNAME = "vvronline";
const BOOTSTRAP_LOCK = "aino:bootstrap:platform-admin:v1";

type Transaction = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;

export interface BootstrapEnvironment {
    PLATFORM_BOOTSTRAP_PASSWORD?: string;
    PLATFORM_BOOTSTRAP_EMAIL?: string;
    PLATFORM_BOOTSTRAP_FULL_NAME?: string;
}

export async function bootstrapPlatformAdmin(
    transaction: Transaction,
    env: BootstrapEnvironment = process.env,
): Promise<"created" | "skipped"> {
    const password = env.PLATFORM_BOOTSTRAP_PASSWORD;
    const email = env.PLATFORM_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const fullName = env.PLATFORM_BOOTSTRAP_FULL_NAME?.trim() || "Platform Administrator";

    if (!password) {
        throw new Error("PLATFORM_BOOTSTRAP_PASSWORD is required");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("PLATFORM_BOOTSTRAP_EMAIL is invalid");
    }
    const passwordError = await validatePassword(password);
    if (passwordError) throw new Error(`PLATFORM_BOOTSTRAP_PASSWORD: ${passwordError}`);

    return transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [BOOTSTRAP_LOCK]);
        const counts = await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM platform_users) AS platform_users,
                (SELECT COUNT(*)::int FROM tenants) AS tenants
        `);
        const row = counts.rows[0];
        if (Number(row.platform_users) !== 0 || Number(row.tenants) !== 0) return "skipped";

        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await client.query(
            `INSERT INTO platform_users
                (username, password, full_name, email, role, must_change_password)
             VALUES ($1, $2, $3, $4, 'platform_admin', TRUE)`,
            [BOOTSTRAP_USERNAME, hash, fullName, email ?? null],
        );
        return "created";
    });
}

async function main(): Promise<void> {
    const { masterTransaction, pool } = require("../db");
    try {
        const result = await bootstrapPlatformAdmin(masterTransaction);
        console.log(result === "created"
            ? `Created tenantless platform administrator '${BOOTSTRAP_USERNAME}'; password change is required.`
            : "Bootstrap skipped: platform users or tenants already exist.");
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error: Error) => {
        console.error(`Platform administrator bootstrap failed: ${error.message}`);
        process.exitCode = 1;
    });
}
