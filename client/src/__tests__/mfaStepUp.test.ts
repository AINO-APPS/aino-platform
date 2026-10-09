import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, test, vi } from "vitest";
import { installMfaStepUp } from "../auth/mfaStepUp";
import { mfaChallengeFrom } from "../components/auth/MfaChallenge";

function stepUpServer(validCode: string) {
  let proven = false;
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    calls.push(`${config.method} ${config.url}`);
    const respond = (status: number, data: unknown) => {
      const response = { status, data, statusText: "", headers: {}, config };
      if (status >= 400) throw new AxiosError("fail", String(status), config, null, response as any);
      return response;
    };
    if (config.url === "/auth/mfa/step-up") {
      if (JSON.parse(String(config.data)).code !== validCode) return respond(401, { code: "MFA_CODE_INVALID" });
      proven = true;
      return respond(200, { stepUpValidFor: 600 });
    }
    return proven ? respond(200, { ok: true }) : respond(403, { code: "MFA_STEP_UP_REQUIRED" });
  };
  return { api: axios.create({ adapter }), calls };
}

describe("admin step-up", () => {
  test("asks for a code, confirms it, then retries the change once", async () => {
    const { api, calls } = stepUpServer("123456");
    const prompt = vi.fn().mockResolvedValueOnce("000000").mockResolvedValueOnce("123456");
    installMfaStepUp(api, prompt);

    const res = await api.delete("/admin/users/5");

    expect(res.data).toEqual({ ok: true });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["delete /admin/users/5", "post /auth/mfa/step-up", "post /auth/mfa/step-up", "delete /admin/users/5"]);
  });

  test("a cancelled prompt keeps the original error", async () => {
    const { api } = stepUpServer("123456");
    installMfaStepUp(api, vi.fn().mockResolvedValue(null));
    await expect(api.put("/admin/users/5/role", {})).rejects.toMatchObject({ response: { data: { code: "MFA_STEP_UP_REQUIRED" } } });
  });

  test("recognises the sign-in second-factor responses", () => {
    expect(mfaChallengeFrom({ code: "MFA_REQUIRED", mfaTicket: "t" })).toEqual({ code: "MFA_REQUIRED", mfaTicket: "t" });
    expect(mfaChallengeFrom({ code: "MFA_ENROLL_REQUIRED", mfaTicket: "t" })?.code).toBe("MFA_ENROLL_REQUIRED");
    expect(mfaChallengeFrom({ code: "MFA_REQUIRED" })).toBeNull();
    expect(mfaChallengeFrom({ error: "Invalid credentials" })).toBeNull();
  });
});
