import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Mic, Keyboard, Smile, Send, Plus, BarChart3, Paperclip } from "../../constants/icons";
import {
  VoiceRecorder,
  ReplyPreview,
  EmojiGifPicker,
  MentionInput,
} from "../../components/chat";
import CameraCapture from "../../components/chat/CameraCapture";
import MediaEditor, {
  type MediaEditorResult,
} from "../../components/chat/MediaEditor";
import VideoPreview from "../../components/chat/VideoPreview";
import { getLinkPreview } from "../../api/chat";
import { serverURL } from "../../api/client";
import s from "./ChatInputBar.module.css";

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

const URL_RE = /https?:\/\/[^\s<]+/;

interface ChatInputBarProps {
  input: string;
  setInput: (val: string) => void;
  editingMsg: any;
  replyTo: any;
  recording: boolean;
  showEmojiPicker: boolean;
  convMembers: any;
  mentionInputRef: any;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isGroup: boolean;
  onSend: (e?: any, extras?: { linkPreview?: LinkPreviewData | null }) => void;
  onFileUpload: (
    file: File,
    opts?: { viewOnce?: boolean; caption?: string },
  ) => void;
  onVoiceSend: (...args: any[]) => void;
  onCancelRecording: () => void;
  onStartRecording: () => void;
  onEmojiInsert: (...args: any[]) => void;
  onToggleEmoji: () => void;
  onOpenPollCreator: () => void;
  onClearReply: () => void;
  onClearEdit: () => void;
  onTyping: () => void;
}

const EDITABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
];

export default function ChatInputBar({
  input,
  setInput,
  editingMsg,
  replyTo,
  recording,
  showEmojiPicker,
  convMembers,
  mentionInputRef,
  fileInputRef,
  isGroup,
  onSend,
  onFileUpload,
  onVoiceSend,
  onCancelRecording,
  onStartRecording,
  onEmojiInsert,
  onToggleEmoji,
  onOpenPollCreator,
  onClearReply,
  onClearEdit,
  onTyping,
}: ChatInputBarProps) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [editorFiles, setEditorFiles] = useState<File[] | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const inputAreaRef = useRef<HTMLDivElement | null>(null);
  const hasText = !!input.trim();

  const openCamera = () => {
    inputAreaRef.current?.querySelector("textarea")?.blur();
    setPlusOpen(false);
    if (showEmojiPicker) onToggleEmoji();
    setCameraOpen(true);
  };
  const openGallery = () => {
    setPlusOpen(false);
    fileInputRef.current?.click();
  };

  // ── Link previews (Signal parity — SENDER-generated) ──
  // Detect the first URL while composing, fetch OpenGraph metadata via the
  // server proxy, show a dismissible card, and attach it on send.
  const [linkPreview, setLinkPreview] = useState<LinkPreviewData | null>(null);
  const [previewDismissedUrl, setPreviewDismissedUrl] = useState<string | null>(
    null,
  );
  const previewFetchRef = useRef<number>(0);

  useEffect(() => {
    const match = input.match(URL_RE);
    const url = match?.[0] || null;
    if (!url) {
      setLinkPreview(null);
      setPreviewDismissedUrl(null);
      return;
    }
    if (url === previewDismissedUrl) return;
    if (linkPreview?.url === url) return;
    const fetchId = ++previewFetchRef.current;
    const timer = setTimeout(async () => {
      try {
        const { data } = await getLinkPreview(url);
        if (previewFetchRef.current === fetchId) {
          setLinkPreview(data as LinkPreviewData);
        }
      } catch {
        if (previewFetchRef.current === fetchId) setLinkPreview(null);
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, previewDismissedUrl]);

  const handleFormSubmit = (e?: any) => {
    e?.preventDefault?.();
    onSend(e, { linkPreview });
    setLinkPreview(null);
    setPreviewDismissedUrl(null);
  };

  useEffect(() => {
    if (!plusOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(e.target as Node)
      ) {
        setPlusOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [plusOpen]);

  // Route a picked/captured image through the Signal-style media editor.
  // Non-image files (documents, etc.) upload directly.
  const routeFile = (file: File) => {
    if (file && EDITABLE_IMAGE_TYPES.includes(file.type)) {
      setEditorFiles([file]);
    } else if (file?.type.startsWith("video/")) {
      setVideoFile(file);
    } else {
      onFileUpload(file);
    }
  };

  const handleEditorSend = (results: MediaEditorResult[]) => {
    results.forEach((r, i) => {
      onFileUpload(r.file, {
        viewOnce: r.viewOnce,
        // Only attach the caption to the first item, matching Signal.
        caption: i === 0 ? r.caption : undefined,
      });
    });
    setEditorFiles(null);
  };

  return (
    <>
      {(replyTo || editingMsg) && (
        <div className={s.replyBar}>
          {editingMsg ? (
            <ReplyPreview
              senderName="Editing"
              content={editingMsg.content}
              onClear={onClearEdit}
            />
          ) : (
            <ReplyPreview
              senderName={replyTo.sender_name}
              content={replyTo.content}
              onClear={onClearReply}
            />
          )}
        </div>
      )}

      {recording && (
        <div className={s.voiceBar}>
          <VoiceRecorder onSend={onVoiceSend} onCancel={onCancelRecording} />
        </div>
      )}

      {!recording && linkPreview && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.5rem 0.8rem",
            margin: "0 0.75rem",
            borderLeft: "3px solid var(--primary)",
            background: "var(--surface, rgba(255,255,255,0.04))",
            borderRadius: "8px",
          }}
        >
          {linkPreview.image && (
            <img
              src={
                linkPreview.image.startsWith("/")
                  ? `${serverURL}${linkPreview.image}`
                  : linkPreview.image
              }
              alt=""
              style={{
                width: 44,
                height: 44,
                objectFit: "cover",
                borderRadius: 6,
                flexShrink: 0,
              }}
              onError={(e) =>
                ((e.target as HTMLImageElement).style.display = "none")
              }
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {linkPreview.title}
            </div>
            {linkPreview.description && (
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {linkPreview.description}
              </div>
            )}
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted, #8a8f98)",
              }}
            >
              {linkPreview.siteName}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPreviewDismissedUrl(linkPreview.url);
              setLinkPreview(null);
            }}
            title="Remove preview"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {!recording && (
        <div ref={inputAreaRef} className={s.inputArea}>
          <form className={s.inputBar} onSubmit={handleFormSubmit}>
            <input
              type="file"
              ref={fileInputRef}
              className={s.fileInput}
              onChange={(e) => {
                if (e.target.files?.[0]) routeFile(e.target.files[0]);
                e.target.value = "";
              }}
            />

            <div className={s.inputBoxWrap}>
              <button
                type="button"
                className={`${s.emojiToggle} ${showEmojiPicker ? s.emojiToggleActive : ""}`}
                onClick={onToggleEmoji}
                title={showEmojiPicker ? "Keyboard" : "Emoji"}
                aria-label={showEmojiPicker ? "Show keyboard" : "Show emoji"}
              >
                {showEmojiPicker ? <Keyboard size={20} /> : <Smile size={20} />}
              </button>

              <MentionInput
                ref={mentionInputRef}
                value={input}
                onChange={(val: string) => {
                  setInput(val);
                  onTyping();
                }}
                members={convMembers}
                placeholder={
                  editingMsg ? "Edit message..." : "Type a message..."
                }
                className={s.msgInput}
                maxLength={5000}
                onSubmit={handleFormSubmit}
              />

              {/* Signal-style: camera + mic live INSIDE the pill, on the
                                right. They collapse while the user is typing to make
                                room for the text, and the send button takes over. */}
              {!hasText && !editingMsg && (
                <>
                  <button
                    type="button"
                    className={s.cameraBtn}
                    onClick={openCamera}
                    title="Camera"
                    aria-label="Open camera"
                  >
                    <Camera size={18} />
                  </button>
                  <button
                    type="button"
                    className={s.micBtn}
                    onClick={onStartRecording}
                    title="Voice message"
                    aria-label="Record voice message"
                  >
                    <Mic size={18} />
                  </button>
                </>
              )}

              {showEmojiPicker && (
                <div className={s.emojiDock}>
                  <EmojiGifPicker
                    onSelectEmoji={onEmojiInsert}
                    onSelectMediaFile={routeFile}
                    onClose={onToggleEmoji}
                  />
                </div>
              )}
            </div>

            {/* Keep attachments accessible while a text draft is present. */}
            {hasText || editingMsg ? (
              <button
                type="submit"
                className={`${s.sendBtn} ${s.sendBtnVisible}`}
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            ) : null}
              <div ref={plusMenuRef} className={s.plusWrap}>
                <button
                  type="button"
                  className={`${s.plusBtn} ${plusOpen ? s.plusBtnOpen : ""}`}
                  onClick={() => setPlusOpen((v) => !v)}
                  title="More options"
                  aria-label="More options"
                  aria-expanded={plusOpen}
                >
                  <Plus size={20} />
                </button>

                {plusOpen && (
                  <div className={s.plusMenu}>
                    <button type="button" className={s.plusMenuItem} onClick={openCamera}>
                      <Camera size={18} /> Camera
                    </button>
                    {isGroup && (
                      <button
                        type="button"
                        className={s.plusMenuItem}
                        onClick={() => {
                          onOpenPollCreator();
                          setPlusOpen(false);
                        }}
                      >
                        <BarChart3 size={18} />
                        Poll
                      </button>
                    )}
                    <button
                      type="button"
                      className={s.plusMenuItem}
                      onClick={openGallery}
                    >
                      <Paperclip size={18} />
                      Attach file
                    </button>
                  </div>
                )}
              </div>
          </form>
        </div>
      )}

      {cameraOpen &&
        createPortal(
          <CameraCapture
            onCapture={(file) => {
              setCameraOpen(false);
              routeFile(file);
            }}
            onClose={() => setCameraOpen(false)}
            onGallery={openGallery}
          />,
          document.body,
        )}

      {videoFile &&
        createPortal(
          <VideoPreview
            file={videoFile}
            onSend={(file, options) => {
              onFileUpload(file, options);
              setVideoFile(null);
            }}
            onClose={() => setVideoFile(null)}
          />,
          document.body,
        )}

      {editorFiles &&
        createPortal(
          <MediaEditor
            initialFiles={editorFiles}
            onSend={handleEditorSend}
            onClose={() => setEditorFiles(null)}
          />,
          document.body,
        )}
    </>
  );
}
