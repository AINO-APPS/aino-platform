import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../api/chat", () => ({ getLinkPreview: vi.fn() }));
vi.mock("../api/client", () => ({ serverURL: "" }));
vi.mock("../components/chat", () => ({
    VoiceRecorder: () => null,
    ReplyPreview: () => null,
    EmojiGifPicker: () => null,
    MentionInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Message" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("../components/chat/CameraCapture", () => ({ default: () => null }));
vi.mock("../components/chat/MediaEditor", () => ({ default: () => null }));
vi.mock("../components/chat/VideoPreview", () => ({ default: () => null }));
import ChatInputBar from "../pages/chat/ChatInputBar";

afterEach(cleanup);

function renderBar({ input = "", replyTo = null, editingMsg = null }: { input?: string; replyTo?: unknown; editingMsg?: unknown }) {
    return <ChatInputBar input={input} setInput={vi.fn()} editingMsg={editingMsg} replyTo={replyTo} recording={false}
        showEmojiPicker={false} convMembers={[]} mentionInputRef={createRef()} fileInputRef={createRef()} isGroup={false}
        onSend={vi.fn()} onFileUpload={vi.fn()} onVoiceSend={vi.fn()} onCancelRecording={vi.fn()} onStartRecording={vi.fn()}
        onEmojiInsert={vi.fn()} onToggleEmoji={vi.fn()} onOpenPollCreator={vi.fn()} onClearReply={vi.fn()} onClearEdit={vi.fn()} onTyping={vi.fn()} />;
}
const nextFrame = () => act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });

test("starting a reply focuses the composer with the caret at the end", async () => {
    const view = render(renderBar({ input: "draft" }));
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await nextFrame();
    expect(textarea).not.toHaveFocus();
    view.rerender(renderBar({ input: "draft", replyTo: { id: 5, sender_name: "Ana", content: "hi" } }));
    await nextFrame();
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
});

test("starting an edit focuses the composer at the end of the edited text", async () => {
    render(renderBar({ input: "fix typo", editingMsg: { id: 9, content: "fix typo" } }));
    await nextFrame();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(8);
});
