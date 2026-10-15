/** HTTP adapter for chat link previews (fetching logic in chat.link-preview.ts). */
import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const redis = require("../../redis");
const { getUploadKey, getUploadUrl } = require("../../utils/uploadPath");
const { getStorage, randomFilename } = require("../../platform/storage");
import {
  LinkPreviewError,
  displayDomain,
  downloadPreviewImage,
  fetchPreviewMeta,
  previewCacheKey,
  resolveImageUrl,
  type LinkPreviewResult,
} from "./chat.link-preview";

const router = express.Router();

const PREVIEW_TTL_SECONDS = 6 * 60 * 60;
const MISS_TTL_SECONDS = 10 * 60;
const DEADLINE_MS = 9000;

/**
 * GET /api/chat/link-preview?url=https://...
 * Fetch OpenGraph metadata for a URL on behalf of the SENDER; the image is
 * re-hosted so the stored preview never hotlinks a third party.
 */
router.get("/link-preview", auth, loadUserContext, async (req: Request, res: Response) => {
  let target: URL;
  try {
    target = new URL(String(req.query.url || ""));
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return res.status(400).json({ error: "Only http/https URLs supported" });
  }

  const tenantId = (req as any).tenantId;
  const orgId = (req as any).userOrgId;
  const cacheKey = previewCacheKey(tenantId, orgId, target.toString());
  const cached = await redis.get(cacheKey);
  if (cached?.error) return res.status(422).json({ error: cached.error });
  if (cached) return res.json(cached);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const { meta, finalUrl } = await fetchPreviewMeta(target, controller.signal);

    let image: string | null = null;
    const imageUrl = resolveImageUrl(meta.image, finalUrl);
    if (imageUrl && tenantId && orgId) {
      const downloaded = await downloadPreviewImage(imageUrl, controller.signal);
      if (downloaded) {
        const name = randomFilename("chat", downloaded.ext);
        try {
          await getStorage().put(getUploadKey(tenantId, orgId, "chat", name), downloaded.bytes, {
            contentType: downloaded.mimetype,
          });
          image = getUploadUrl(tenantId, orgId, "chat", name);
        } catch (err) {
          req.log.warn({ err }, "Link preview image store failed");
        }
      }
    }

    const domain = displayDomain(target.toString());
    const result: LinkPreviewResult = {
      url: target.toString(),
      title: meta.title || domain,
      description: meta.description || "",
      image,
      siteName: domain || meta.siteName || "",
    };
    await redis.set(cacheKey, result, PREVIEW_TTL_SECONDS);
    res.json(result);
  } catch (err: any) {
    if (err instanceof LinkPreviewError) {
      if (err.status === 422) await redis.set(cacheKey, { error: err.message }, MISS_TTL_SECONDS);
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.name === "AbortError") {
      return res.status(422).json({ error: "Preview timed out" });
    }
    req.log.error({ err }, "Link preview error");
    res.status(500).json({ error: "Failed to fetch preview" });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
