import { describe, expect, test, vi } from "vitest";
import { completeLogin } from "../auth/completeLogin";

describe("completeLogin", () => {
  test("redirects a cross-realm handoff without starting local authentication", () => {
    const saveAuth = vi.fn();
    const redirect = vi.fn();
    const url = "https://console.aino.org.in/auth/handoff#t=signed-ticket";

    expect(completeLogin({ redirect: url }, saveAuth, redirect)).toBe("redirected");
    expect(redirect).toHaveBeenCalledWith(url);
    expect(saveAuth).not.toHaveBeenCalled();
  });

  test("saves a same-realm user response without redirecting", () => {
    const saveAuth = vi.fn();
    const redirect = vi.fn();
    const user = { id: 9, username: "operator", role: "platform_admin" } as any;

    expect(completeLogin({ user }, saveAuth, redirect)).toBe("authenticated");
    expect(saveAuth).toHaveBeenCalledWith(user);
    expect(redirect).not.toHaveBeenCalled();
  });

  test("rejects malformed success responses instead of authenticating undefined", () => {
    const saveAuth = vi.fn();

    expect(() => completeLogin({}, saveAuth, vi.fn())).toThrow(
      "Login succeeded without a user or redirect",
    );
    expect(saveAuth).not.toHaveBeenCalled();
  });
});
