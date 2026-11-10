import { clientHeaders, isFirstPartyApi } from "./clientIdentity";
import { inspectClientUpgrade } from "./clientUpgrade";

export async function firstPartyFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!isFirstPartyApi(url)) {
        for (const header of ["Authorization", "Cookie", "X-AINO-Client", "X-AINO-Client-Version", "X-Requested-With"]) headers.delete(header);
        return fetch(input, { ...init, headers, credentials: "omit" });
    }
    Object.entries(clientHeaders()).forEach(([name, value]) => headers.set(name, value));
    const response = await fetch(input, { ...init, headers, redirect: init.redirect ?? "error" });
    if (response.status === 426) {
        try { await inspectClientUpgrade({ status: response.status, data: await response.clone().json() }); }
        catch { /* Leave the response available for the caller's error handling. */ }
    }
    return response;
}
