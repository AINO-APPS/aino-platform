import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../api/chat", () => ({ getLinkPreview: vi.fn() }));
vi.mock("../api/client", () => ({ serverURL: "" }));
vi.mock("../components/chat", () => ({
  VoiceRecorder: () => null,
  ReplyPreview: () => null,
  EmojiGifPicker: () => <div>Emoji picker</div>,
  MentionInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Message" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("../components/chat/CameraCapture", () => ({ default: ({ onCapture, onClose, onGallery }: any) => <div role="dialog" aria-label="Camera">
  <button onClick={onClose}>Close camera</button>
  <button onClick={() => onCapture(new File(["image"], "photo.jpg", { type: "image/jpeg" }))}>Take photo</button>
  <button onClick={() => onCapture(new File(["video"], "video.webm", { type: "video/webm" }))}>Record video</button>
  <button onClick={() => { onClose(); onGallery(); }}>Gallery</button>
</div> }));
vi.mock("../components/chat/MediaEditor", () => ({ default: ({ initialFiles, onClose, onSend }: any) => <div role="dialog" aria-label="Image editor"><span>{initialFiles[0].name}</span><button onClick={onClose}>Discard image</button><button onClick={() => onSend([{ file: initialFiles[0], caption: "image caption", viewOnce: true }])}>Send image</button></div> }));
vi.mock("../components/chat/VideoPreview", () => ({ default: ({ file, onClose, onSend }: any) => <div role="dialog" aria-label="Video preview"><span>{file.name}</span><button onClick={onClose}>Discard video</button><button onClick={() => onSend(file, { caption: "video caption", viewOnce: true })}>Send video</button></div> }));
import ChatInputBar from "../pages/chat/ChatInputBar";

afterEach(cleanup);
function setup(draft = "", emoji = false) {
  const fileInputRef = createRef<HTMLInputElement>();
  const setInput = vi.fn(); const toggleEmoji = vi.fn(); const upload = vi.fn(); const send = vi.fn();
  function Composer() {
    const [input, setDraft] = useState(draft); const [showEmojiPicker, showEmoji] = useState(emoji);
    return <ChatInputBar input={input} setInput={(value) => { setInput(value); setDraft(value); }}
      editingMsg={null} replyTo={null} recording={false} showEmojiPicker={showEmojiPicker}
      convMembers={[]} mentionInputRef={createRef()} fileInputRef={fileInputRef} isGroup
      onSend={send} onFileUpload={upload} onVoiceSend={vi.fn()} onCancelRecording={vi.fn()} onStartRecording={vi.fn()}
      onEmojiInsert={vi.fn()} onToggleEmoji={() => { toggleEmoji(); showEmoji((value) => !value); }}
      onOpenPollCreator={vi.fn()} onClearReply={vi.fn()} onClearEdit={vi.fn()} onTyping={vi.fn()} />;
  }
  render(<Composer />);
  return { fileInputRef, setInput, toggleEmoji, upload, send };
}
const openTrayCamera = () => { fireEvent.click(screen.getByLabelText("More options")); fireEvent.click(screen.getByRole("button", { name: "Camera" })); };

describe("composer camera integration", () => {
  test("tray camera blurs textarea, closes overlays and preserves a typed draft after dismiss", () => {
    const app = setup("unfinished message", true);
    const textarea = screen.getByLabelText("Message"); textarea.focus();
    openTrayCamera();
    expect(textarea).not.toHaveFocus(); expect(textarea).toHaveValue("unfinished message");
    expect(screen.queryByText("Emoji picker")).toBeNull(); expect(app.toggleEmoji).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("More options")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Close camera" }));
    expect(textarea).toHaveValue("unfinished message"); expect(textarea).not.toHaveFocus();
    expect(app.setInput).not.toHaveBeenCalled(); expect(app.send).not.toHaveBeenCalled();
  });
  test("inline camera uses the same overlay cleanup path", () => {
    const app = setup("", true); const textarea = screen.getByLabelText("Message"); textarea.focus();
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByLabelText("Open camera"));
    expect(textarea).not.toHaveFocus(); expect(screen.queryByText("Emoji picker")).toBeNull();
    expect(app.toggleEmoji).toHaveBeenCalledTimes(1); expect(screen.getByRole("dialog", { name: "Camera" })).toBeInTheDocument();
  });
  test("photo goes to existing image review without uploading or clearing draft", () => {
    const app = setup("keep this"); openTrayCamera(); fireEvent.click(screen.getByText("Take photo"));
    expect(screen.getByRole("dialog", { name: "Image editor" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Camera" })).toBeNull(); expect(app.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Send image"));
    expect(app.upload).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }), { caption: "image caption", viewOnce: true });
    expect(screen.getByLabelText("Message")).toHaveValue("keep this"); expect(app.setInput).not.toHaveBeenCalled();
  });
  test("video goes to existing VideoPreview, never the image editor", () => {
    const app = setup("keep draft"); openTrayCamera(); fireEvent.click(screen.getByText("Record video"));
    expect(screen.getByRole("dialog", { name: "Video preview" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Image editor" })).toBeNull();
    fireEvent.click(screen.getByText("Send video"));
    expect(app.upload).toHaveBeenCalledWith(expect.objectContaining({ type: "video/webm" }), { caption: "video caption", viewOnce: true });
    expect(screen.getByLabelText("Message")).toHaveValue("keep draft");
  });
  test("camera gallery reuses existing picker and file routing", () => {
    const app = setup("draft"); openTrayCamera();
    const click = vi.spyOn(app.fileInputRef.current!, "click"); fireEvent.click(screen.getByText("Gallery"));
    expect(click).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog", { name: "Camera" })).toBeNull();
    fireEvent.change(app.fileInputRef.current!, { target: { files: [new File(["v"], "selected.mp4", { type: "video/mp4" })] } });
    expect(screen.getByRole("dialog", { name: "Video preview" })).toBeInTheDocument();
    expect(app.fileInputRef.current!.value).toBe(""); expect(screen.getByLabelText("Message")).toHaveValue("draft");
    fireEvent.click(screen.getByText("Discard video"));
    fireEvent.change(app.fileInputRef.current!, { target: { files: [new File(["d"], "document.pdf", { type: "application/pdf" })] } });
    expect(app.upload).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf" }));
  });
});
