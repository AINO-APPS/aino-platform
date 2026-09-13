import type { User } from "../types";

export interface SuccessfulAuthResponse {
  redirect?: string;
  user?: User;
}

/**
 * Complete a successful auth response without briefly authenticating on the
 * wrong host. Cross-realm handoffs are terminal: navigate before touching
 * local auth state so profile hydration and realtime connections cannot start
 * with a cookie that belongs to another hostname.
 */
export function completeLogin(
  response: SuccessfulAuthResponse,
  saveAuth: (user: User) => void,
  redirect: (url: string) => void = (url) => window.location.assign(url),
): "redirected" | "authenticated" {
  if (response?.redirect) {
    redirect(response.redirect);
    return "redirected";
  }
  if (!response?.user) {
    throw new Error("Login succeeded without a user or redirect");
  }
  saveAuth(response.user);
  return "authenticated";
}
