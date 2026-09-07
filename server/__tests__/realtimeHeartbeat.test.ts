import { attachSocketHeartbeat, handleApplicationPing, startHeartbeat } from "../realtime/heartbeat";
import type { ExtWS } from "../realtime/types";

function socket(): ExtWS {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    readyState: 1,
    send: jest.fn(), close: jest.fn(), terminate: jest.fn(), ping: jest.fn(),
    on: jest.fn((event, listener) => { handlers[event] = listener; }),
    _handlers: handlers,
  };
}

describe("realtime heartbeat boundary", () => {
  afterEach(() => jest.useRealTimers());

  test("responds to application pings and resets missed pongs", () => {
    const ws = socket();
    ws._missedPongs = 2;
    expect(handleApplicationPing(ws)).toBe(true);
    expect(ws.isAlive).toBe(true);
    expect(ws._missedPongs).toBe(0);
    expect(ws.send).toHaveBeenCalledWith('{"type":"pong"}');
  });

  test("transport pong refreshes proof of life", () => {
    const ws = socket();
    const proof = jest.fn();
    attachSocketHeartbeat(ws, proof);
    ws.isAlive = false;
    ws._missedPongs = 2;
    ws._handlers.pong();
    expect(ws._missedPongs).toBe(0);
    expect(proof).toHaveBeenCalledWith(ws);
  });

  test("tolerates two missed pongs and terminates on the third", async () => {
    jest.useFakeTimers();
    const ws = socket();
    ws.isAlive = false;
    const closeHandler: { current?: () => void } = {};
    const server = { clients: new Set([ws]), on: jest.fn((_event, fn) => { closeHandler.current = fn; }) };
    const revalidate = jest.fn().mockResolvedValue(undefined);
    const onTerminate = jest.fn();
    startHeartbeat(server, { revalidate, onTerminate, onProofOfLife: jest.fn() });

    jest.advanceTimersByTime(60_000);
    expect(ws.terminate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30_000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(onTerminate).toHaveBeenCalledWith(ws);
    closeHandler.current?.();
  });
});
