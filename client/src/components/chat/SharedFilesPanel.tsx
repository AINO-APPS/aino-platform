import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, FileText, Image as ImageIcon, Link2, Music, Play } from "lucide-react";
import s from "./SharedFilesPanel.module.css";
import { getSharedFiles } from "../../api/chat";
import { isBeforeClearedAt } from "../../pages/chat/chatLocalDeletes";
import FilePreview from "./FilePreview";
import VideoViewer from "./video/VideoViewer";
import { useVideoMeta } from "./video/useVideoMeta";
import { saveToDevice } from "./messageActions";

interface SharedFile {
    id: number | string;
    file_url?: string;
    file_name?: string;
    file_type?: string;
    file_size?: number;
    sender_name?: string;
    created_at?: string;
    [key: string]: unknown;
}

type Tab = "media" | "files" | "audio" | "links";
const TABS: { key: Tab; label: string }[] = [
    { key: "media", label: "Media" },
    { key: "files", label: "Files" },
    { key: "audio", label: "Audio" },
    { key: "links", label: "Links" },
];

const isVisual = (t?: string) => !!t && (t.startsWith("image/") || t.startsWith("video/"));
const isAudio = (t?: string) => !!t && t.startsWith("audio/");

function formatSize(bytes?: number): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaTile({ file, onOpen }: { file: SharedFile; onOpen: () => void }) {
    const video = !!file.file_type?.startsWith("video/");
    const meta = useVideoMeta(file.file_url || "", video);
    const src = video ? meta.poster : file.file_url;
    return (
        <button type="button" className={s.tile} onClick={onOpen} aria-label={file.file_name || (video ? "Video" : "Photo")}>
            {src ? <img src={src} alt="" loading="lazy" /> : <span className={s.tileBlank} />}
            {video && (
                <span className={s.tilePlay}>
                    <Play size={11} fill="currentColor" />
                </span>
            )}
        </button>
    );
}

interface SharedFilesPanelProps {
    convId: number | string;
    title?: string;
    /** Loaded thread messages: the server has no links endpoint, so links come from these. */
    messages?: any[];
    onJumpTo?: (msgId: number | string) => void;
    onClose: () => void;
}

/** Android "All media" page: Media grid · Files · Audio · Links tabs. */
export default function SharedFilesPanel({ convId, title, messages = [], onJumpTo, onClose }: SharedFilesPanelProps) {
    const [files, setFiles] = useState<SharedFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("media");
    const [viewing, setViewing] = useState<SharedFile | null>(null);

    useEffect(() => {
        if (!convId) return;
        setLoading(true);
        getSharedFiles(convId)
            .then(({ data }) =>
                setFiles((data as SharedFile[]).filter((f) => !isBeforeClearedAt(convId, f.created_at))),
            )
            .catch(() => setFiles([]))
            .finally(() => setLoading(false));
    }, [convId]);

    const visual = useMemo(() => files.filter((f) => isVisual(f.file_type)), [files]);
    const audio = useMemo(() => files.filter((f) => isAudio(f.file_type)), [files]);
    const docs = useMemo(() => files.filter((f) => !isVisual(f.file_type) && !isAudio(f.file_type)), [files]);
    const links = useMemo(
        () => messages.filter((m) => !m.deleted_at && m.link_preview).slice().reverse(),
        [messages],
    );

    const empty = (icon: React.ReactNode, text: string) => (
        <div className={s.emptyState}>
            <div className={s.emptyIcon}>{icon}</div>
            <p className={s.emptyTitle}>{text}</p>
        </div>
    );

    return (
        <div className={s.panel} role="dialog" aria-label="All media">
            <div className={s.header}>
                <button className={s.closeBtn} onClick={onClose} aria-label="Back">
                    <ArrowLeft size={20} />
                </button>
                <span className={s.title}>{title || "All media"}</span>
            </div>
            <div className={s.tabs} role="tablist">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        role="tab"
                        aria-selected={tab === t.key}
                        className={`${s.tab} ${tab === t.key ? s.tabActive : ""}`}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className={s.list}>
                {loading && tab !== "links" && <div className={s.empty}>Loading…</div>}
                {!loading && tab === "media" &&
                    (visual.length === 0 ? (
                        empty(<ImageIcon size={40} strokeWidth={1.3} />, "No media")
                    ) : (
                        <div className={s.grid}>
                            {visual.map((f) => (
                                <MediaTile key={f.id} file={f} onOpen={() => setViewing(f)} />
                            ))}
                        </div>
                    ))}
                {!loading && tab === "files" &&
                    (docs.length === 0
                        ? empty(<FileText size={40} strokeWidth={1.3} />, "No files")
                        : docs.map((f) => {
                              const ext = (f.file_name?.split(".").pop() || "").slice(0, 4).toUpperCase() || "FILE";
                              return (
                                  <div key={f.id} className={s.fileRow}>
                                      <a className={s.fileMain} href={f.file_url} target="_blank" rel="noopener noreferrer">
                                          <span className={s.fileExt}>{ext}</span>
                                          <span className={s.fileText}>
                                              <span className={s.fileName}>{f.file_name || "File"}</span>
                                              <span className={s.fileSub}>
                                                  {[formatSize(f.file_size), f.sender_name].filter(Boolean).join(" · ")}
                                              </span>
                                          </span>
                                      </a>
                                      <button
                                          className={s.fileSave}
                                          onClick={() => f.file_url && saveToDevice(f.file_url, f.file_name)}
                                          aria-label="Save to device"
                                          title="Save to device"
                                      >
                                          <Download size={18} />
                                      </button>
                                  </div>
                              );
                          }))}
                {!loading && tab === "audio" &&
                    (audio.length === 0
                        ? empty(<Music size={40} strokeWidth={1.3} />, "No audio")
                        : audio.map((f) => (
                              <div key={f.id} className={s.audioRow}>
                                  <FilePreview fileUrl={f.file_url as string} fileType={f.file_type} isMessage />
                                  <span className={s.fileSub}>
                                      {[f.sender_name, f.created_at && new Date(f.created_at).toLocaleDateString()].filter(Boolean).join(" · ")}
                                  </span>
                              </div>
                          )))}
                {tab === "links" &&
                    (links.length === 0
                        ? empty(<Link2 size={40} strokeWidth={1.3} />, "No links")
                        : links.map((m) => (
                              <button
                                  key={m.id}
                                  className={s.linkRow}
                                  onClick={() => {
                                      onClose();
                                      onJumpTo?.(m.id);
                                  }}
                              >
                                  {m.link_preview.image ? (
                                      <img src={m.link_preview.image} alt="" className={s.linkThumb} />
                                  ) : (
                                      <span className={s.linkThumb}>
                                          <Link2 size={18} />
                                      </span>
                                  )}
                                  <span className={s.fileText}>
                                      <span className={s.fileName}>{m.link_preview.title || m.link_preview.url}</span>
                                      <span className={s.fileSub}>{m.link_preview.siteName || m.link_preview.url}</span>
                                  </span>
                              </button>
                          )))}
            </div>
            {viewing &&
                createPortal(
                    viewing.file_type?.startsWith("video/") ? (
                        <VideoViewer
                            src={viewing.file_url as string}
                            fileName={viewing.file_name}
                            meta={{ senderName: viewing.sender_name, sentAt: viewing.created_at }}
                            onClose={() => setViewing(null)}
                        />
                    ) : (
                        <div className={s.imageViewer} onClick={() => setViewing(null)}>
                            <img src={viewing.file_url} alt={viewing.file_name || ""} onClick={(e) => e.stopPropagation()} />
                        </div>
                    ),
                    document.body,
                )}
        </div>
    );
}
