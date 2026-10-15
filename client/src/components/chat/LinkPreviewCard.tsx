import { X } from "../../constants/icons";
import { resolveServerAsset } from "../../utils/serverAsset";
import s from "./LinkPreviewCard.module.css";

export interface LinkPreview {
    url: string;
    title?: string | null;
    description?: string | null;
    image?: string | null;
    siteName?: string | null;
}

interface Props {
    preview: LinkPreview;
    isMine?: boolean;
    /** Composer: shows a ✕ and renders a non-navigating card. */
    onRemove?: () => void;
    loading?: boolean;
}

/** Signal shows the bare host ("share.google"), falling back to the site name. */
export function previewDomain(preview: Pick<LinkPreview, "url" | "siteName">): string {
    try {
        const host = new URL(preview.url).hostname.replace(/^www\./i, "");
        if (host) return host;
    } catch {
        /* not an absolute URL */
    }
    return preview.siteName || "";
}

/** Signal Android `LinkPreviewView` (small layout): thumbnail left, title · description · domain right. */
export default function LinkPreviewCard({ preview, isMine, onRemove, loading }: Props) {
    const image = resolveServerAsset(preview.image);
    const domain = previewDomain(preview);
    const body = (
        <>
            {image && !loading && (
                <img
                    src={image}
                    alt=""
                    className={s.thumb}
                    decoding="async"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                />
            )}
            <div className={s.text}>
                {loading ? (
                    <div className={s.loading}>Loading preview…</div>
                ) : (
                    <>
                        {preview.title && <div className={s.title}>{preview.title}</div>}
                        {preview.description && <div className={s.description}>{preview.description}</div>}
                        {domain && <div className={s.domain}>{domain}</div>}
                    </>
                )}
            </div>
        </>
    );
    const className = `${s.card} ${isMine ? s.mine : s.theirs}`;

    if (onRemove) {
        return (
            <div className={`${className} ${s.composer}`} data-testid="link-preview-card">
                {body}
                <button type="button" className={s.remove} onClick={onRemove} title="Remove preview" aria-label="Remove preview">
                    <X size={15} />
                </button>
            </div>
        );
    }
    return (
        <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            data-testid="link-preview-card"
        >
            {body}
        </a>
    );
}
