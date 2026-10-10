import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useWebSocket, { REALTIME_EVENT, REALTIME_CONNECTED_EVENT, SESSION_REVOKED_EVENT, SIGNED_IN_ELSEWHERE_REASON } from "../hooks/useWebSocket";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  close(code = 1006, reason = "") {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(value: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("socket is not open");
    }
    this.sent.push(value);
  }
}

describe("useWebSocket reliable chat delivery", () => {
  test("announces connection recovery separately from server messages", () => {
    const connected = vi.fn();
    const onMessage = vi.fn();
    window.addEventListener(REALTIME_CONNECTED_EVENT, connected);
    const { unmount } = renderHook(() => useWebSocket(onMessage));
    act(() => MockWebSocket.instances[0].open());
    expect(connected).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    act(() => MockWebSocket.instances[0].close());
    act(() => vi.runOnlyPendingTimers());
    act(() => MockWebSocket.instances[1].open());
    expect(connected).toHaveBeenCalledTimes(2);
    unmount();
    window.removeEventListener(REALTIME_CONNECTED_EVENT, connected);
  });
  test("an extra feature socket opening while realtime is up is not a recovery", () => {
    const connected = vi.fn();
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    window.addEventListener(REALTIME_CONNECTED_EVENT, connected);
    const first = renderHook(() => useWebSocket(onFirst));
    act(() => MockWebSocket.instances[0].open());
    expect(connected).toHaveBeenCalledTimes(1);
    // A newly visited page mounts its own socket.
    const second = renderHook(() => useWebSocket(onSecond));
    act(() => MockWebSocket.instances[1].open());
    expect(connected).toHaveBeenCalledTimes(1);
    // Realtime only recovers after every socket dropped.
    act(() => MockWebSocket.instances[0].close());
    act(() => MockWebSocket.instances[1].close());
    act(() => vi.runOnlyPendingTimers());
    act(() => MockWebSocket.instances[2].open());
    act(() => MockWebSocket.instances[3].open());
    expect(connected).toHaveBeenCalledTimes(2);
    first.unmount();
    second.unmount();
    window.removeEventListener(REALTIME_CONNECTED_EVENT, connected);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("sends immediately when the socket is available", () => {
    const onMessage = vi.fn();
    const { result, unmount } = renderHook(() => useWebSocket(onMessage));
    const socket = MockWebSocket.instances[0];

    act(() => socket.open());
    act(() =>
      result.current.sendMessage("chat_message", {
        conversationId: 1,
        content: "hello",
        clientMsgId: "pending_one",
      }),
    );

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "chat_message",
      data: { clientMsgId: "pending_one" },
    });
    unmount();
  });

  test("does not connect when the handler is disabled", () => {
    const { result, unmount } = renderHook(() => useWebSocket(null));

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
    unmount();
  });

  test("waits offline and flushes as soon as the connection opens", () => {
    const onMessage = vi.fn();
    const { result, unmount } = renderHook(() => useWebSocket(onMessage));
    const socket = MockWebSocket.instances[0];

    act(() =>
      result.current.sendMessage("chat_message", {
        conversationId: 1,
        content: "queued",
        clientMsgId: "pending_offline",
      }),
    );
    expect(socket.sent).toHaveLength(0);

    act(() => socket.open());

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]).data.clientMsgId).toBe("pending_offline");
    unmount();
  });

  test("retries an unacknowledged message after reconnect and stops after its echo", () => {
    const onMessage = vi.fn();
    const { result, unmount } = renderHook(() => useWebSocket(onMessage));
    const first = MockWebSocket.instances[0];

    act(() => first.open());
    act(() =>
      result.current.sendMessage("chat_message", {
        conversationId: 1,
        content: "retry me",
        clientMsgId: "pending_retry",
      }),
    );
    expect(first.sent).toHaveLength(1);

    act(() => first.close());
    act(() => vi.runOnlyPendingTimers());
    const second = MockWebSocket.instances[1];
    act(() => second.open());

    expect(second.sent).toHaveLength(1);
    expect(JSON.parse(second.sent[0]).data.clientMsgId).toBe("pending_retry");

    act(() =>
      second.receive({
        type: "chat_message",
        data: {
          id: 9,
          conversationId: 1,
          senderId: 2,
          clientMsgId: "pending_retry",
        },
      }),
    );
    act(() => second.close());
    act(() => vi.runOnlyPendingTimers());
    const third = MockWebSocket.instances[2];
    act(() => third.open());

    expect(third.sent).toHaveLength(0);
    expect(onMessage).toHaveBeenCalledTimes(1);
    unmount();
  });

  test("publishes one application event when duplicate sockets receive the same frame", () => {
    const globalListener = vi.fn();
    window.addEventListener(REALTIME_EVENT, globalListener);
    const firstHook = renderHook(() => useWebSocket(vi.fn()));
    const secondHook = renderHook(() => useWebSocket(vi.fn()));
    const payload = { type: "chat_message", data: { id: 501, conversationId: 4 } };
    act(() => {
      MockWebSocket.instances[0].receive(payload);
      MockWebSocket.instances[1].receive(payload);
    });
    expect(globalListener).toHaveBeenCalledTimes(1);
    firstHook.unmount();
    secondHook.unmount();
    window.removeEventListener(REALTIME_EVENT, globalListener);
  });
  test("a session replaced by another sign-in announces the sign-out and stops reconnecting", () => {
    const revoked = vi.fn();
    window.addEventListener(SESSION_REVOKED_EVENT, revoked);
    const { unmount } = renderHook(() => useWebSocket(vi.fn()));
    const live = () => MockWebSocket.instances.filter((s) => s.readyState !== MockWebSocket.CLOSED).at(-1)!;
    act(() => live().open());
    act(() => live().close(4001, SIGNED_IN_ELSEWHERE_REASON));
    const count = MockWebSocket.instances.length;
    act(() => vi.runOnlyPendingTimers());
    expect(revoked).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(count);

    const other = renderHook(() => useWebSocket(vi.fn()));
    act(() => live().close(4001, "Session ended"));
    other.unmount();
    expect(revoked).toHaveBeenCalledTimes(1);
    unmount();
    window.removeEventListener(SESSION_REVOKED_EVENT, revoked);
  });});
