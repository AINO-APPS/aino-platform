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
const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

// `docker info` can exit 0 with no server version when the daemon is down, so
// check the version itself rather than the exit code.
const daemon = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
if (daemon.status !== 0 || !daemon.stdout.trim()) {
    console.error("test:pg needs a running Docker daemon (start Docker Desktop and retry).");
    process.exit(1);
}

// Let Docker choose a free loopback port: a fixed port can fall inside a range
// Windows has reserved (`netsh interface ipv4 show excludedportrange`), where
// the mapping is created but never answers.
docker("run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=aino_test",
    "-p", "127.0.0.1::5432", "postgres:16");

let status = 1;
try {
    const port = docker("port", name, "5432/tcp").split(/\r?\n/)[0].split(":").pop();
    const url = `postgres://postgres:test@127.0.0.1:${port}/aino_test`;
    const deadline = Date.now() + 60_000;
    for (;;) {
        // -h forces TCP: the image's init phase answers on the unix socket
        // before the server listens on the network port the tests use.
        const ready = spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "aino_test"]);
        if (ready.status === 0) break;
        if (Date.now() > deadline) throw new Error("postgres:16 did not become ready within 60s");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // Postgres-gated suites are named `*.integration.test.ts`. Flags such as
    // --runInBand pass through without replacing that default pattern.
    const args = process.argv.slice(2);
    const hasPattern = args.some((arg) => !arg.startsWith("-"));
    const pattern = hasPattern ? args : [...args, "\\.integration\\.test\\.ts$"];
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
