import {
  clients,
  clientKey,
  hasOpenSocket,
  registerConnection,
  unregisterConnection,
} from "../realtime/registry";
import type { ExtWS } from "../realtime/types";

const socket = (readyState = 1): ExtWS => ({
  readyState,
  send: jest.fn(), close: jest.fn(), terminate: jest.fn(), ping: jest.fn(), on: jest.fn(),
});

describe("realtime connection registry", () => {
  afterEach(() => clients.clear());

  test("isolates users with the same id across tenants", () => {
    const first = socket();
    const second = socket();
    registerConnection(1, 7, first, 12);
    registerConnection(2, 7, second, 12);

    expect(clientKey(1, 7)).not.toBe(clientKey(2, 7));
    expect(clients.get("1:7")).toEqual(new Set([first]));
    expect(clients.get("2:7")).toEqual(new Set([second]));
  });

  test("enforces the limit without mutating the registry", () => {
    const first = socket();
    const rejected = socket();
    expect(registerConnection(1, 7, first, 1)).toEqual({ accepted: true, wasOffline: true });
    expect(registerConnection(1, 7, rejected, 1)).toEqual({ accepted: false, wasOffline: false });
    expect(clients.get("1:7")).toEqual(new Set([first]));
  });

  test("reports last disconnect and only counts open sockets", () => {
    const closed = socket(3);
    const open = socket(1);
    registerConnection(null, 7, closed, 12);
    registerConnection(null, 7, open, 12);
    expect(hasOpenSocket(null, 7)).toBe(true);
    expect(unregisterConnection(null, 7, open)).toBe(false);
    expect(hasOpenSocket(null, 7)).toBe(false);
    expect(unregisterConnection(null, 7, closed)).toBe(true);
    expect(clients.has("0:7")).toBe(false);
  });
});
