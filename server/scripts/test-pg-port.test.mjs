import assert from "node:assert/strict";
import test from "node:test";
import { waitForPublishedPort } from "./test-pg-port.mjs";

test("waits for Docker to publish a loopback port instead of connecting to default PostgreSQL", async () => {
    const responses = ["", "\r\n", "127.0.0.1:38001\r\n"];
    const port = await waitForPublishedPort(() => responses.shift(), { intervalMs: 0 });
    assert.equal(port, "38001");
});

test("never accepts an absent, malformed, non-loopback or out-of-range mapping", async () => {
    for (const mapping of ["", "127.0.0.1:", "0.0.0.0:38001", "127.0.0.1:0", "127.0.0.1:65536"]) {
        await assert.rejects(waitForPublishedPort(() => mapping, {
            timeoutMs: 1, intervalMs: 0,
        }), /Docker did not publish a loopback PostgreSQL port/);
    }
});
