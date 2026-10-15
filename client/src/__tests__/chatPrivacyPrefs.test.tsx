import { createRef, useState } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_PREFS } from "../utils/sounds";

const mocks = vi.hoisted(() => ({
    prefs: {} as Record<string, unknown>,
    updatePrefs: vi.fn(),
    getLinkPreview: vi.fn(),
    editorQuality: [] as unknown[],
}));
vi.mock("../NotificationPrefsContext", () => ({
    useNotificationPrefs: () => ({ prefs: mocks.prefs, updatePrefs: mocks.updatePrefs, resetPrefs: vi.fn(), preview: vi.fn() }),
}));
vi.mock("../api/chat", () => ({ getLinkPreview: mocks.getLinkPreview, createConversation: vi.fn() }));
vi.mock("../api/client", () => ({ serverURL: "" }));
vi.mock("../components/chat", () => ({
    VoiceRecorder: () => null,
    ReplyPreview: () => null,
    EmojiGifPicker: () => null,
    MentionInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Message" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("../components/chat/CameraCapture", () => ({ default: () => null }));
vi.mock("../components/chat/VideoPreview", () => ({ default: () => null }));
vi.mock("../components/chat/MediaEditor", () => ({
    default: ({ initialQuality }: { initialQuality?: string }) => { mocks.editorQuality.push(initialQuality); return <div role="dialog" aria-label="Image editor" />; },
}));
vi.mock("../pages/chat/useMessageActions", () => ({ default: () => ({}) }));
vi.mock("../pages/chat/useConversationActions", () => ({ default: () => ({}) }));
vi.mock("../pages/chat/useCallActions", () => ({ default: () => ({}) }));

import ChatInputBar from "../pages/chat/ChatInputBar";
import useChatActions from "../pages/chat/useChatActions";
import useChatPageExtras from "../pages/chat/useChatPageExtras";
import NotificationSoundsModal from "../components/profile/NotificationSoundsModal";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefs = { ...DEFAULT_PREFS };
    mocks.editorQuality = [];
    mocks.getLinkPreview.mockResolvedValue({ data: { url: "https://example.com", title: "Example", description: "", image: null, siteName: "" } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderComposer() {
    const fileInputRef = createRef<HTMLInputElement>();
    const send = vi.fn();
    function Composer() {
        const [input, setInput] = useState("");
        return <ChatInputBar input={input} setInput={setInput} editingMsg={null} replyTo={null} recording={false}
            showEmojiPicker={false} convMembers={[]} mentionInputRef={createRef()} fileInputRef={fileInputRef} isGroup={false}
            onSend={send} onFileUpload={vi.fn()} onVoiceSend={vi.fn()} onCancelRecording={vi.fn()} onStartRecording={vi.fn()}
            onEmojiInsert={vi.fn()} onToggleEmoji={vi.fn()} onOpenPollCreator={vi.fn()} onClearReply={vi.fn()} onClearEdit={vi.fn()} onTyping={vi.fn()} />;
    }
    render(<Composer />);
    return { fileInputRef, send };
}

async function typeUrlAndWait() {
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "see https://example.com" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
}

describe("link previews preference", () => {
    test("fetches and attaches a preview by default", async () => {
        const app = renderComposer();
        await typeUrlAndWait();
        expect(mocks.getLinkPreview).toHaveBeenCalledWith("https://example.com");
        expect(screen.getByText("Example")).toBeInTheDocument();
        fireEvent.submit(screen.getByLabelText("Message").closest("form")!);
        expect(app.send.mock.calls[0][1]).toMatchObject({ linkPreview: { title: "Example" } });
    });

    test("never fetches or attaches a preview when disabled", async () => {
        mocks.prefs.linkPreviews = false;
        const app = renderComposer();
        await typeUrlAndWait();
        expect(mocks.getLinkPreview).not.toHaveBeenCalled();
        expect(screen.queryByText("Example")).toBeNull();
        fireEvent.submit(screen.getByLabelText("Message").closest("form")!);
        expect(app.send.mock.calls[0][1]).toEqual({ linkPreview: null });
    });
});

describe("sent media quality preference", () => {
    test.each([["standard", "standard"], ["high", "hd"]])("%s opens the image editor at %s", (pref, expected) => {
        mocks.prefs.sentMediaQuality = pref;
        const app = renderComposer();
        fireEvent.change(app.fileInputRef.current!, { target: { files: [new File(["i"], "a.jpg", { type: "image/jpeg" })] } });
        expect(screen.getByRole("dialog", { name: "Image editor" })).toBeInTheDocument();
        expect(mocks.editorQuality.at(-1)).toBe(expected);
    });
});

describe("typing indicators preference", () => {
    function chatState() {
        return { activeConv: { id: 7 }, typingTimerRef: { current: null }, wsSend: vi.fn(), typingUsers: { 7: 3 } } as any;
    }

    test("sends chat_typing when enabled", () => {
        vi.useFakeTimers();
        const state = chatState();
        const { result } = renderHook(() => useChatActions(state));
        act(() => { result.current.handleTyping(); vi.advanceTimersByTime(300); });
        expect(state.wsSend).toHaveBeenCalledWith("chat_typing", { conversationId: 7 });
    });

    test("does not send chat_typing when disabled", () => {
        vi.useFakeTimers();
        mocks.prefs.typingIndicators = false;
        const state = chatState();
        const { result } = renderHook(() => useChatActions(state));
        act(() => { result.current.handleTyping(); vi.advanceTimersByTime(300); });
        expect(state.wsSend).not.toHaveBeenCalled();
    });

    test("hides incoming typing indicators when disabled", () => {
        const state = chatState();
        expect(renderHook(() => useChatPageExtras(state, {})).result.current.visibleTypingUsers).toEqual({ 7: 3 });
        mocks.prefs.typingIndicators = false;
        expect(renderHook(() => useChatPageExtras(state, {})).result.current.visibleTypingUsers).toEqual({});
    });
});

describe("privacy settings controls", () => {
    test("toggles typing indicators, link previews and sent media quality", () => {
        render(<NotificationSoundsModal onClose={vi.fn()} />);
        const typing = screen.getByRole("checkbox", { name: /Typing indicators/ });
        const previews = screen.getByRole("checkbox", { name: /Generate link previews/ });
        expect(typing).toBeChecked();
        expect(previews).toBeChecked();
        expect(screen.getByText("If disabled, you won't send or see typing indicators.")).toBeInTheDocument();
        fireEvent.click(typing);
        fireEvent.click(previews);
        fireEvent.change(screen.getByLabelText("Sent media quality"), { target: { value: "high" } });
        expect(mocks.updatePrefs).toHaveBeenCalledWith({ typingIndicators: false });
        expect(mocks.updatePrefs).toHaveBeenCalledWith({ linkPreviews: false });
        expect(mocks.updatePrefs).toHaveBeenCalledWith({ sentMediaQuality: "high" });
    });
});
