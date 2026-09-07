import type { IncomingMessage } from "http";
import { resolveRealtimeToken, revalidateSocketSession } from "../realtime/auth";
import type { ExtWS } from "../realtime/types";

const request = (headers: Record<string, string> = {}, url = "/ws") => ({ headers, url }) as IncomingMessage;
const socket = (): ExtWS => ({
  readyState: 1, userId: 3, _sessionId: "session", db: { query: jest.fn() },
  send: jest.fn(), close: jest.fn(), terminate: jest.fn(), ping: jest.fn(), on: jest.fn(),
});

describe("realtime authentication boundary", () => {
  test("preserves cookie, query, then protocol token precedence", () => {
    expect(resolveRealtimeToken(request({ cookie: "token=cookie", "sec-websocket-protocol": "protocol" }, "/ws?token=query"))).toBe("cookie");
    expect(resolveRealtimeToken(request({ "sec-websocket-protocol": "protocol" }, "/ws?token=query"))).toBe("query");
    expect(resolveRealtimeToken(request({ "sec-websocket-protocol": "protocol, other" }))).toBe("protocol");
    expect(resolveRealtimeToken(request())).toBeUndefined();
  });

  test("closes an ended session and clears the in-flight guard", async () => {
    const ws = socket();
    await revalidateSocketSession(ws, jest.fn().mockResolvedValue("ended"));
    expect(ws.close).toHaveBeenCalledWith(4001, "Session ended");
    expect(ws._heartbeatAuthCheckInFlight).toBe(false);
  });

  test("fails open on transient validation errors", async () => {
    const ws = socket();
    await revalidateSocketSession(ws, jest.fn().mockRejectedValue(new Error("db unavailable")));
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws._heartbeatAuthCheckInFlight).toBe(false);
  });
});
