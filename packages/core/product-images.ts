export type ProductImageCandidate = {
  urls: string[];
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
};

const MAX_PRODUCT_IMAGES = 7;
const MIN_RENDERED_EDGE = 120;
const SENSITIVE_QUERY_KEY = /(?:^|_)(?:token|auth|session|signature|sign|secret|cookie|credential|access_key|share_id)(?:$|_)/i;

function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "xhscdn.com" || host.endsWith(".xhscdn.com") ||
    host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com");
}

/** Keep only public HTTPS image URLs on Xiaohongshu-owned image/content hosts. */
export function normalizeProductImageUrl(raw: string, baseUrl?: string): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096) return null;
  let url: URL;
  try {
    url = baseUrl ? new URL(raw.trim(), baseUrl) : new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !isAllowedImageHost(url.hostname)) return null;
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) return null;
  }
  url.hash = "";
  return url.toString();
}

/** Parse persisted image data defensively; never return arbitrary external URLs. */
export function normalizeProductImageUrls(value: unknown, limit = MAX_PRODUCT_IMAGES, baseUrl?: string): string[] {
  if (!Array.isArray(value)) return [];
  const requested = Number.isFinite(limit) ? Math.trunc(limit) : MAX_PRODUCT_IMAGES;
  const cap = Math.max(0, Math.min(MAX_PRODUCT_IMAGES, requested));
  if (cap === 0) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const url = normalizeProductImageUrl(item, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= cap) break;
  }
  return result;
}

export function parseStoredProductImageUrls(value: unknown): string[] {
  if (typeof value !== "string") return normalizeProductImageUrls(value);
  try {
    return normalizeProductImageUrls(JSON.parse(value));
  } catch {
    return [];
  }
}

/** Select large product-page images, excluding small icons and gallery thumbnails. */
export function selectProductImageUrls(
  candidates: readonly ProductImageCandidate[],
  baseUrl?: string,
  limit = MAX_PRODUCT_IMAGES
): string[] {
  const urls: string[] = [];
  for (const candidate of candidates) {
    const hasRenderedSize = candidate.renderedWidth > 0 && candidate.renderedHeight > 0;
    const largeEnough = hasRenderedSize
      ? candidate.renderedWidth >= MIN_RENDERED_EDGE && candidate.renderedHeight >= MIN_RENDERED_EDGE
      : candidate.naturalWidth >= MIN_RENDERED_EDGE && candidate.naturalHeight >= MIN_RENDERED_EDGE;
    if (!largeEnough) continue;
    urls.push(...candidate.urls);
  }
  return normalizeProductImageUrls(urls, limit, baseUrl);
}
