import { act, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockWsSend = vi.fn();
let wsHandler: ((msg: { type: string; data?: unknown }) => void) | null = null;

vi.mock("../hooks/useWebSocket", () => ({
    default: (onMessage: typeof wsHandler) => {
        wsHandler = onMessage;
        return { sendMessage: mockWsSend };
    },
}));

vi.mock("../AuthContext", () => ({
    useAuth: () => ({ isAuthenticated: true, user: { id: 2, tenant_id: 1 } }),
    hasTenantContext: () => true,
}));

vi.mock("../api/chat", () => ({ getActiveCall: vi.fn().mockResolvedValue({ data: null }) }));

import { CallProvider } from "../CallContext";
import useCallState from "../pages/chat/useCallState";
import { ToastProvider } from "../components/common/Toast";

function deliver(type: string, data: Record<string, unknown>) {
    act(() => {
        wsHandler?.({ type, data });
    });
}

describe("callee: call_ringing ack", () => {
    beforeEach(() => {
        mockWsSend.mockClear();
        wsHandler = null;
    });

    test("sends call_ringing once per incoming callId", () => {
        render(<CallProvider><div /></CallProvider>);

        deliver("call_incoming", { callId: 5, conversationId: 9, callerId: 1, callType: "voice" });
        deliver("call_incoming", { callId: 5, conversationId: 9, callerId: 1, callType: "voice" });
        deliver("call_ended", { callId: 5, conversationId: 9 });
        deliver("call_incoming", { callId: 5, conversationId: 9, callerId: 1, callType: "voice" });

        const acks = mockWsSend.mock.calls.filter(([type]) => type === "call_ringing");
        expect(acks).toEqual([["call_ringing", { callId: 5, conversationId: 9 }]]);

        deliver("call_ended", { callId: 5, conversationId: 9 });
        deliver("call_incoming", { callId: 6, conversationId: 9, callerId: 1, callType: "video" });
        expect(mockWsSend).toHaveBeenLastCalledWith("call_ringing", { callId: 6, conversationId: 9 });
    });

    test("does not ack huddle rings (no 1:1 call log)", () => {
        render(<CallProvider><div /></CallProvider>);

        deliver("call_incoming", { callId: 40, conversationId: 9, meetingCode: "abc-def", isHuddle: true });

        expect(mockWsSend).not.toHaveBeenCalledWith("call_ringing", expect.anything());
    });
});

describe("caller: Calling... → Ringing...", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter>
            <CallProvider>
                <ToastProvider>{children}</ToastProvider>
            </CallProvider>
        </MemoryRouter>
    );

    function outgoingCall() {
        const { result } = renderHook(() => useCallState({ current: vi.fn() }), { wrapper });
        act(() => {
            result.current.setCallState({ conversationId: 9, callType: "voice", isIncoming: false });
        });
        return result;
    }

    test("marks the outgoing call as ringing on a matching call_ringing", () => {
        const result = outgoingCall();
        act(() => result.current.handleCallWsEvent("call_started", { callId: 5 }));
        expect(result.current.callState?.remoteRinging).toBeUndefined();

        act(() => result.current.handleCallWsEvent("call_ringing", { callId: 5, conversationId: 9, userId: 2 }));
        expect(result.current.callState?.remoteRinging).toBe(true);
    });

    test("matches by conversation before call_started assigned the callId", () => {
        const result = outgoingCall();
        act(() => result.current.handleCallWsEvent("call_ringing", { callId: 5, conversationId: 9, userId: 2 }));
        expect(result.current.callState?.remoteRinging).toBe(true);
    });

    test("ignores call_ringing for another call or an incoming call", () => {
        const result = outgoingCall();
        act(() => result.current.handleCallWsEvent("call_started", { callId: 5 }));
        act(() => result.current.handleCallWsEvent("call_ringing", { callId: 99, conversationId: 9, userId: 2 }));
        act(() => result.current.handleCallWsEvent("call_ringing", { callId: 5, conversationId: 8, userId: 2 }));
        expect(result.current.callState?.remoteRinging).toBeUndefined();

        act(() => {
            result.current.setCallState({ callId: 7, conversationId: 9, isIncoming: true });
        });
        act(() => result.current.handleCallWsEvent("call_ringing", { callId: 7, conversationId: 9, userId: 2 }));
        expect(result.current.callState?.remoteRinging).toBeUndefined();
    });
});
