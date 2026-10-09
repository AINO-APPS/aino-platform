import { describe, expect, test } from "vitest";
import { captureError, initErrorTracking, scrubEvent, scrubText, setErrorUser } from "../errorTracking";

describe("web error tracking", () => {
  test("stays off without a DSN", async () => {
    await initErrorTracking();
    expect(() => {
      setErrorUser({ id: 1, tenant_id: 2 });
      captureError(new Error("boom"));
    }).not.toThrow();
  });

  test("removes request data, personal fields and console breadcrumbs", () => {
    const event = scrubEvent({
      request: { url: "https://app.example.test/chat?token=abc#x", headers: { cookie: "a" }, data: "x", cookies: {}, query_string: "q" },
      user: { id: "7", email: "ana@example.test", ip_address: "10.0.0.1" },
      exception: { values: [{ value: "Failed for ana@example.test" }] },
      breadcrumbs: [
        { category: "console", message: "secret" },
        { category: "navigation", message: "to /profile ana@example.test", data: { from: "/a" } },
      ],
    });
    expect(event.request).toEqual({ url: "https://app.example.test/chat" });
    expect(event.user).toEqual({ id: "7" });
    expect(event.exception.values[0].value).toBe("Failed for [email]");
    expect(event.breadcrumbs).toEqual([{ category: "navigation", message: "to /profile [email]" }]);
  });

  test("masks tokens", () => {
    expect(scrubText("Bearer abc.def eyJa.eyJb.c")).toBe("Bearer [redacted] [jwt]");
  });
});
