import type { ClientUpgradeRequired } from "../types/generated/tasks";

let requirement: ClientUpgradeRequired | null = null;
const listeners = new Set<() => void>();
export const getClientUpgrade = () => requirement;
export function subscribeClientUpgrade(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export async function inspectClientUpgrade(response?: { status: number; data: unknown }): Promise<void> {
    if (response?.status !== 426 || requirement) return;
    try {
        let data: any = response.data;
        if (typeof data?.text === "function") data = await data.text();
        if (ArrayBuffer.isView(data) || Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
            data = new TextDecoder().decode(data);
        }
        if (typeof data === "string") data = JSON.parse(data);
        if (data?.code !== "CLIENT_UPGRADE_REQUIRED" || !["android", "desktop", "web"].includes(data.client)
            || typeof data.min_version !== "string" || typeof data.current_version !== "string") return;
        requirement = data;
        listeners.forEach(listener => listener());
    } catch { /* A malformed response must not hide the original API failure. */ }
}
