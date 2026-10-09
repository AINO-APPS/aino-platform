import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

/**
 * Step-up for administrative changes (P2.1). When the server answers
 * `403 MFA_STEP_UP_REQUIRED`, ask for a code, confirm it at
 * `/auth/mfa/step-up` (which refreshes the session cookie's proof) and retry
 * the original request once. Concurrent requests share one prompt.
 */
type Prompt = () => Promise<string | null>;

let pending: Promise<boolean> | null = null;

const defaultPrompt: Prompt = async () =>
  window.prompt("Confirm it's you: enter the 6-digit code from your authenticator app (or a recovery code).")?.trim() || null;

export function installMfaStepUp(api: AxiosInstance, prompt: Prompt = defaultPrompt): number {
  return api.interceptors.response.use(undefined, async (error: AxiosError<{ code?: string }>) => {
    const config = error.config as (InternalAxiosRequestConfig & { _mfaRetried?: boolean }) | undefined;
    if (error.response?.status !== 403 || error.response.data?.code !== "MFA_STEP_UP_REQUIRED" || !config || config._mfaRetried) {
      throw error;
    }
    pending ??= (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = await prompt();
        if (!code) return false;
        try {
          await api.post("/auth/mfa/step-up", { code });
          return true;
        } catch {
          /* wrong code: ask again */
        }
      }
      return false;
    })().finally(() => { pending = null; });
    if (!(await pending)) throw error;
    config._mfaRetried = true;
    return api.request(config);
  });
}
