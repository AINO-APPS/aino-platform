import { readClientVersionConfig } from "./clientVersions.config";
import type { Observation, VersionConfig, Query, VersionRepository } from "./clientVersions.types";
interface Principal {
    userId: number; tenantId: number | null; sessionId?: string | null;
    isPlatformUser?: boolean; isImpersonated?: boolean; query?: Query;
}
export function createClientVersionService(repository: VersionRepository, config = readClientVersionConfig) {
    return {
        config: (): VersionConfig => config(),
        report: () => repository.report(),
        async observe(principal: Principal, observation?: Observation): Promise<void> {
            if (config().mode !== "report" || !observation || principal.isImpersonated
                || !Number.isSafeInteger(principal.userId) || principal.userId <= 0) return;
            const identity = principal.tenantId != null
                ? `tenant:${principal.tenantId}:user:${principal.userId}`
                : principal.isPlatformUser ? `platform:${principal.userId}` : null;
            if (!identity) return;
            const session = principal.sessionId && principal.query
                ? { userId: principal.userId, sid: principal.sessionId, query: principal.query } : undefined;
            await repository.record(identity, observation, session);
        },
    };
}
