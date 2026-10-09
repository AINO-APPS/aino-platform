export {};

const { scrubEvent, scrubText, captureError, initErrorTracking, errorTrackingEnabled } = require("../bootstrap/errorTracking");

describe("error tracking", () => {
    test("is off without a DSN and under tests, and capturing is then a no-op", () => {
        delete process.env.SENTRY_DSN;
        initErrorTracking();
        expect(errorTrackingEnabled()).toBe(false);
        expect(() => captureError(new Error("boom"), { userId: 1 })).not.toThrow();
    });

    test("strips request bodies, cookies, auth headers, query strings and personal fields", () => {
        const event = scrubEvent({
            request: {
                url: "https://app.example.test/api/auth/login?token=abc",
                data: { password: "secret" },
                cookies: { token: "abc" },
                query_string: "token=abc",
                headers: { authorization: "Bearer abc", cookie: "token=abc", "x-aino-device-id": "dev", "user-agent": "UA" },
            },
            user: { id: "42", email: "ana@example.test", ip_address: "10.0.0.1", username: "ana" },
            exception: { values: [{ type: "Error", value: "Failed for ana@example.test with Bearer abc.def" }] },
            breadcrumbs: [{ message: "login ana@example.test", data: { body: "x" } }],
        });

        expect(event.request).toEqual({ url: "https://app.example.test/api/auth/login", headers: { "user-agent": "UA" } });
        expect(event.user).toEqual({ id: "42" });
        expect(event.exception.values[0].value).toBe("Failed for [email] with Bearer [redacted]");
        expect(event.breadcrumbs[0]).toEqual({ message: "login [email]" });
    });

    test("masks JWTs in free text", () => {
        expect(scrubText("token eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig-part ok")).toBe("token [jwt] ok");
    });
});
