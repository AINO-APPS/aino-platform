import { createClientVersionService } from "../modules/clientVersions/clientVersions.service";

test("authenticated usage persists tenant-safe identities only in report, independently of login exclusivity", async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const report = jest.fn().mockResolvedValue([{ client: "web", version: "3.0.79", users: 2 }]);
    let mode: "off" | "report" = "off";
    const service = createClientVersionService({ record, report }, () => ({
        mode, minimums: { android: "0.0.0", desktop: "0.0.0", web: "0.0.0" },
    }));
    const query = jest.fn();
    const principal = { userId: 7, tenantId: 1, sessionId: "session-a", query };
    const observation = { client: "web" as const, version: "3.0.79" };
    await service.observe(principal, observation);
    expect(record).not.toHaveBeenCalled();
    mode = "report";
    await service.observe(principal, observation);
    await service.observe({ ...principal, tenantId: 2 }, observation);
    await service.observe({ ...principal, tenantId: null, isPlatformUser: true }, observation);
    expect(record.mock.calls.map(([key]) => key)).toEqual(["tenant:1:user:7", "tenant:2:user:7", "platform:7"]);
    expect(record.mock.calls[0][2]).toEqual({ userId: 7, sid: "session-a", query });
    await service.observe({ ...principal, isImpersonated: true }, observation);
    await service.observe({ ...principal, tenantId: null }, observation);
    await service.observe(principal, undefined);
    expect(record).toHaveBeenCalledTimes(3);
    expect(await service.report()).toEqual([{ client: "web", version: "3.0.79", users: 2 }]);
});
