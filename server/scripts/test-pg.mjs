/**
 * Run the PostgreSQL-gated suites against a throwaway postgres:16 container.
 *
 *   npm run test:pg                 # every suite gated on TASKS_SCHEMA_TEST_DATABASE_URL
 *   npm run test:pg -- placement    # extra args go to jest
 *
 * Needs Docker. The container is removed afterwards, pass or fail. CI uses a
 * service container instead (see .github/workflows/ci.yml).
 */
import { execFileSync, spawnSync } from "node:child_process";

const name = `aino-test-pg-${process.pid}`;
const port = 55000 + (process.pid % 1000);
const url = `postgres://postgres:test@localhost:${port}/aino_test`;
const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

try {
    docker("info", "--format", "{{.ServerVersion}}");
} catch {
    console.error("test:pg needs a running Docker daemon (start Docker Desktop and retry).");
    process.exit(1);
}

docker("run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=aino_test",
    "-p", `${port}:5432`, "postgres:16");

let status = 1;
try {
    const deadline = Date.now() + 60_000;
    for (;;) {
        const ready = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres", "-d", "aino_test"]);
        if (ready.status === 0) break;
        if (Date.now() > deadline) throw new Error("postgres:16 did not become ready within 60s");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // Postgres-gated suites are named `*.integration.test.ts`.
    const pattern = process.argv.slice(2).length ? process.argv.slice(2) : ["\\.integration\\.test\\.ts$"];
    const run = spawnSync("npx", ["jest", "--forceExit", ...pattern], {
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, TASKS_SCHEMA_TEST_DATABASE_URL: url },
    });
    status = run.status ?? 1;
} finally {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}
process.exit(status);
