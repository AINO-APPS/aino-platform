const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
let handler, cspHandler, fetchImpl;
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === "electron") return {
    net: { fetch: (...args) => fetchImpl(...args) },
    protocol: { handle: (_scheme, callback) => { handler = callback; } },
  };
  return originalLoad.call(this, id, ...args);
};
const { setupProtocolHandling } = require("../protocol");
Module._load = originalLoad;
setupProtocolHandling({
  apiServer: "https://api.example",
  clientDist: __dirname,
  r2OriginPattern: "https://*.r2.cloudflarestorage.com",
  electronSession: { webRequest: { onHeadersReceived: (callback) => { cspHandler = callback; } } },
});
const request = (method = "GET") => new Request("workpulse://app/uploads/clip.mp4?key=one", {
  method, headers: { range: "bytes=0-1", accept: "video/mp4", authorization: "do-not-forward" },
});

test("streams authorized upload ranges before the upstream body finishes", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); } });
  const upstream = new Response(body, { status: 206, headers: {
    "content-type": "video/mp4", "content-range": "bytes 0-1/20", "content-length": "2",
    "access-control-allow-origin": "https://bucket.example", "set-cookie": "private=value",
  } });
  upstream.arrayBuffer = () => { throw new Error("Must not buffer media"); };
  fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.example/uploads/clip.mp4?key=one");
    assert.equal(options.credentials, "include");
    assert.equal(options.redirect, "manual");
    assert.deepEqual(options.headers, { origin: "workpulse://app", "x-requested-with": "WorkPulse", accept: "video/mp4", range: "bytes=0-1" });
    return upstream;
  };
  const result = await handler(request());
  assert.equal(result.status, 206);
  assert.equal(result.body, body);
  assert.equal(result.headers.get("content-range"), "bytes 0-1/20");
  assert.equal(result.headers.get("content-length"), "2");
  assert.equal(result.headers.get("content-type"), "video/mp4");
  assert.equal(result.headers.get("accept-ranges"), "bytes");
  assert.equal(result.headers.get("access-control-allow-origin"), null);
  assert.equal(result.headers.get("set-cookie"), null);
  assert.match(result.headers.get("cache-control"), /^private/);
  const reader = result.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  await reader.cancel();
});

test("legacy signed redirects forward ranges but never auth or origin", async () => {
  let calls = 0;
  fetchImpl = async (url, options) => {
    if (++calls === 1) return new Response(null, { status: 302, headers: { location: "https://bucket.example/signed" } });
    assert.equal(url, "https://bucket.example/signed");
    assert.equal(options.credentials, "omit");
    assert.deepEqual(options.headers, { range: "bytes=0-1" });
    return new Response(new Uint8Array([1, 2]), { status: 206, headers: { "content-range": "bytes 0-1/20" } });
  };
  const result = await handler(request());
  assert.equal(calls, 2);
  assert.equal(result.status, 206);
  assert.equal(result.headers.get("content-range"), "bytes 0-1/20");
  assert.equal(result.headers.get("content-type"), "video/mp4");
});

test("HEAD retains upstream metadata with no body", async () => {
  fetchImpl = async (_url, options) => {
    assert.equal(options.method, "HEAD");
    return new Response(null, { headers: { "content-type": "video/mp4", "content-length": "20" } });
  };
  const result = await handler(request("HEAD"));
  assert.equal(result.status, 200);
  assert.equal(result.body, null);
  assert.equal(result.headers.get("content-length"), "20");
});

test("keeps upstream failure status and HEAD errors bodyless", async () => {
  for (const status of [401, 403, 404, 416, 500]) {
    fetchImpl = async () => new Response("denied", { status });
    assert.equal((await handler(request())).status, status);
    const result = await handler(request("HEAD"));
    assert.equal(result.status, status);
    assert.equal(result.body, null);
  }
});

test("does not reuse compressed content length after fetch decompression", async () => {
  fetchImpl = async () => new Response("decoded", { headers: { "content-length": "100", "content-encoding": "gzip" } });
  const result = await handler(request());
  assert.equal(result.headers.get("content-length"), null);
  assert.equal(await result.text(), "decoded");
});

test("preserves image, audio and document upload delivery", async () => {
  for (const [name, type] of [["avatar.png", "image/png"], ["voice.mp3", "audio/mpeg"], ["document.pdf", "application/pdf"]]) {
    fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type, "content-length": "3" } });
    const result = await handler(new Request(`workpulse://app/uploads/${name}`));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), type);
    assert.equal(result.headers.get("content-length"), "3");
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([1, 2, 3]));
  }
});

test("app CSP allows media without weakening script or object restrictions", () => {
  let result;
  cspHandler({ url: "workpulse://app/", resourceType: "mainFrame", responseHeaders: {} }, (value) => { result = value; });
  const csp = result.responseHeaders["Content-Security-Policy"][0];
  assert.match(csp, /media-src 'self' workpulse:\/\/app blob: https:\/\/api\.example https:\/\/\*\.r2\.cloudflarestorage\.com;/);
  assert.match(csp, /object-src 'none';/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});
