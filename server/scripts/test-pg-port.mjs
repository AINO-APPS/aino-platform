export async function waitForPublishedPort(readMapping, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const port = String(readMapping() ?? "").trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
        if (port && Number(port) > 0 && Number(port) <= 65535) return port;
        if (Date.now() >= deadline) throw new Error("Docker did not publish a loopback PostgreSQL port");
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}
