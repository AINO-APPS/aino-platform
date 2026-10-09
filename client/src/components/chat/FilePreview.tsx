import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Image,
  Music,
  Film,
  FileText,
  Table2,
  FileEdit,
  Package,
  Paperclip,
  X,
  Eye,
  EyeOff,
  Timer,
} from "lucide-react";
import { markMessageViewed } from "../../api/chat";
import VideoThumb from "./video/VideoThumb";
import type { ViewerMeta } from "./video/VideoViewer";
import s from "./FilePreview.module.css";

const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ type }: { type?: string }) {
  const size = 20;
  if (type && IMAGE_TYPES.includes(type)) return <Image size={size} />;
  if (type?.startsWith("audio/")) return <Music size={size} />;
  if (type?.startsWith("video/")) return <Film size={size} />;
  if (type?.includes("pdf")) return <FileText size={size} />;
  if (type?.includes("spreadsheet") || type?.includes("excel"))
    return <Table2 size={size} />;
  if (type?.includes("document") || type?.includes("word"))
    return <FileEdit size={size} />;
  if (type?.includes("zip") || type?.includes("compressed"))
    return <Package size={size} />;
  return <Paperclip size={size} />;
}

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2];
const audioDurationCache = new Map<string, number>();
// Intrinsic aspect ratio ("w / h") per image URL, remembered across mounts so a
// re-opened conversation reserves the exact attachment height on the FIRST
// paint instead of settling on it a frame later.
const imageAspectCache = new Map<string, string>();

interface AudioPlayerProps {
  fileUrl: string;
  fileType?: string;
}

function AudioPlayer({ fileUrl, fileType }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    () => audioDurationCache.get(fileUrl) || 0,
  );
  const [speedIdx, setSpeedIdx] = useState(0);
  const progressRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      const d = audio.duration;
      setDuration(d);
      if (Number.isFinite(d) && d > 0) {
        audioDurationCache.set(fileUrl, d);
      }
    };
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, [fileUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying((p) => !p);
  }, [playing]);

  const seek = useCallback(
    (e: React.MouseEvent) => {
      const audio = audioRef.current;
      const bar = progressRef.current;
      if (!audio || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      audio.currentTime = ratio * duration;
    },
    [duration],
  );

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }, [speedIdx]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={s.audioPlayer}>
      <audio ref={audioRef} preload="metadata">
        <source src={fileUrl} type={fileType} />
      </audio>

      <button
        className={s.playBtn}
        onClick={togglePlay}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2" width="4" height="12" rx="1" />
            <rect x="9" y="2" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5v11l9-5.5L4 2.5z" />
          </svg>
        )}
      </button>

      <div className={s.trackArea}>
        <div className={s.progressBar} ref={progressRef} onClick={seek}>
          <div className={s.progressFill} style={{ width: `${progress}%` }} />
          <div className={s.progressThumb} style={{ left: `${progress}%` }} />
        </div>
        <div className={s.timeRow}>
          <span className={s.timeLabel}>{fmtTime(currentTime)}</span>
          <span className={s.timeLabel}>{fmtTime(duration)}</span>
        </div>
      </div>

      <button
        className={s.speedBtn}
        onClick={cycleSpeed}
        title="Playback speed"
      >
        {SPEEDS[speedIdx]}x
      </button>
    </div>
  );
}

interface FilePreviewProps {
  fileUrl: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  isMessage?: boolean;
  /** Message id — required for view-once consume. */
  messageId?: number | string;
  /** View-once metadata from the message. */
  viewOnce?: boolean;
  /**
   * Recipient: whether they already consumed the view-once media.
   * Sender: whether any recipient has viewed it.
   */
  viewOnceConsumed?: boolean;
  /** Whether the current user is the sender (sender can't open view-once media). */
  isMine?: boolean;
  /** Video bubbles: caption present (wider Signal media box). */
  withCaption?: boolean;
  /** Sender/actions shown in the full-screen video viewer. */
  viewer?: ViewerMeta;
}

export default function FilePreview({
  fileUrl,
  fileName,
  fileType,
  fileSize,
  isMessage,
  messageId,
  viewOnce,
  viewOnceConsumed,
  isMine,
  withCaption,
  viewer,
}: FilePreviewProps) {
  const [lightbox, setLightbox] = useState(false);
  // Drives the `--img-aspect` custom property on .imgWrap so the bubble
  // reserves the image's real height. Falls back to the CSS 4/3 default until
  // the first decode reports the intrinsic size.
  const [imgAspect, setImgAspect] = useState<string | null>(
    () => imageAspectCache.get(fileUrl) || null,
  );
  // View-once: resolved URL fetched on demand when the recipient taps to view.
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(!!viewOnceConsumed);
  const [loadingView, setLoadingView] = useState(false);
  const isImage = !!fileType && IMAGE_TYPES.includes(fileType);
  const isAudio = fileType?.startsWith("audio/");
  const isVideo = fileType?.startsWith("video/");

  // Record the decoded image's intrinsic ratio so .imgWrap holds exactly the
  // right height from here on (and immediately on any future mount, via the
  // module-level cache).
  const handleImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;
      const ratio = `${w} / ${h}`;
      imageAspectCache.set(fileUrl, ratio);
      setImgAspect((prev) => (prev === ratio ? prev : ratio));
    },
    [fileUrl],
  );

  const openViewOnce = useCallback(async () => {
    // The sender can't open their own view-once media (server returns 403).
    if (loadingView || isMine || consumed) return;
    setLoadingView(true);
    try {
      const { data } = await markMessageViewed(messageId as number | string);
      if (data?.fileUrl) {
        setRevealedUrl(data.fileUrl);
        setLightbox(true);
        setConsumed(true);
      } else {
        setConsumed(true);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingView(false);
    }
  }, [loadingView, isMine, consumed, messageId]);

  // ─── View-once image bubble ───
  if (viewOnce && isImage && isMessage) {
    // The sender's card is never interactive; it flips to "Viewed" once any
    // recipient has opened the media.
    const alreadyViewed = isMine ? !!viewOnceConsumed : consumed;
    const inert = alreadyViewed || !!isMine;
    return (
      <>
        <button
          type="button"
          className={`${s.viewOnceCard} ${alreadyViewed ? s.viewOnceDone : ""}`}
          onClick={inert ? undefined : openViewOnce}
          disabled={inert || loadingView}
        >
          <span className={s.viewOnceIcon}>
            {alreadyViewed ? <EyeOff size={16} /> : <Timer size={16} />}
          </span>
          <span className={s.viewOnceLabel}>
            {alreadyViewed ? "Viewed" : loadingView ? "Opening…" : "Photo"}
          </span>
          {!inert && <Eye size={15} className={s.viewOnceEye} />}
        </button>
        {lightbox &&
          revealedUrl &&
          createPortal(
            <div className={s.lightbox} onClick={() => setLightbox(false)}>
              <button className={s.lbClose} onClick={() => setLightbox(false)}>
                <X size={16} />
              </button>
              <img
                src={revealedUrl}
                alt={fileName}
                className={s.lbImage}
                onClick={(e) => e.stopPropagation()}
              />
              <div className={s.lbViewOnceNote}>
                This photo can only be viewed once
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  if (isImage && isMessage) {
    return (
      <>
        <div
          className={s.imgWrap}
          onClick={() => setLightbox(true)}
          style={
            imgAspect
              ? ({ "--img-aspect": imgAspect } as React.CSSProperties)
              : undefined
          }
        >
          <img
            src={fileUrl}
            alt={fileName}
            className={s.image}
            // NOT lazy: an in-thread attachment sitting just above the newest
            // message would otherwise start fetching only after the thread has
            // been scrolled/painted, growing the timeline AFTER the
            // "open at latest" pin ran and stranding the user mid-history.
            // The full-screen viewer below is still loaded on demand.
            decoding="async"
            onLoad={handleImgLoad}
          />
        </div>
        {lightbox &&
          createPortal(
            <FullScreenImage
              url={fileUrl}
              fileName={fileName}
              onClose={() => setLightbox(false)}
            />,
            document.body,
          )}
      </>
    );
  }

  if (isAudio && isMessage) {
    return <AudioPlayer fileUrl={fileUrl} fileType={fileType} />;
  }

  if (isVideo && isMessage) {
    return (
      <VideoThumb fileUrl={fileUrl} fileName={fileName} withCaption={withCaption} viewer={viewer} />
    );
  }

  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={s.file}
    >
      <span className={s.icon}>
        <FileTypeIcon type={fileType} />
      </span>
      <div className={s.info}>
        <span className={s.name}>{fileName || "File"}</span>
        {!!fileSize && fileSize > 0 && (
          <span className={s.size}>{formatSize(fileSize)}</span>
        )}
      </div>
    </a>
  );
}

/**
 * FullScreenImage — Signal-style full-screen image viewer with scroll-to-zoom,
 * drag-to-pan when zoomed, Esc/click-to-close and a download button.
 */
function FullScreenImage({
  url,
  fileName,
  onClose,
  allowDownload = true,
}: {
  url: string;
  fileName?: string;
  onClose: () => void;
  allowDownload?: boolean;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const next = Math.min(5, Math.max(1, prev - e.deltaY * 0.0015));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.ox + (e.clientX - drag.current.x),
      y: drag.current.oy + (e.clientY - drag.current.y),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className={s.lightbox} onClick={onClose} onWheel={onWheel}>
      <button className={s.lbClose} onClick={onClose}>
        <X size={16} />
      </button>
      <img
        src={url}
        alt={fileName}
        className={s.lbImage}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "default",
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setScale((p) => (p > 1 ? 1 : 2));
          setOffset({ x: 0, y: 0 });
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        draggable={false}
      />
      {allowDownload && (
        <a
          href={url}
          download={fileName}
          className={s.lbDownload}
          onClick={(e) => e.stopPropagation()}
        >
          ⬇ Download
        </a>
      )}
    </div>
  );
}
