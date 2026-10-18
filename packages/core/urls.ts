import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Stable identity for a Xiaohongshu goods-detail link.
 * Strip all share/referral tokens (including nested instation_link) without storing them.
 * Nested itemId in the share payload is NOT the product ID.
 */
export function parseXhsGoodsUrl(value: string): { productId: string; canonicalUrl: string } {
  if (typeof value !== 'string' || value.trim().length > 8192) throw new Error('INVALID_URL');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('INVALID_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('INVALID_URL');

  const hostname = url.hostname.toLowerCase();
  if (!['xiaohongshu.com', 'www.xiaohongshu.com', 'm.xiaohongshu.com', 'www.xiaohongshu.com.cn'].includes(hostname))
    throw new Error('UNSUPPORTED_HOST');

  const match = /^\/goods-detail\/([a-f0-9]{24})\/?$/i.exec(url.pathname);
  if (!match) throw new Error('UNSUPPORTED_PRODUCT_URL');

  const productId = match[1].toLowerCase();
  return {
    productId,
    canonicalUrl: 'https://www.xiaohongshu.com/goods-detail/' + productId
  };
}

export function normalizedProductUrl(value: string): string {
  return parseXhsGoodsUrl(value).canonicalUrl;
}

export function safeHostname(hostname: string, allowed: string[]): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(name) || name === 'localhost' || name.endsWith('.local')) return false;
  return allowed.some(v => {
    const suffix = v.toLowerCase().replace(/^\./, '');
    return name === suffix || name.endsWith('.' + suffix);
  });
}
function isPrivate(address: string): boolean {
  const a = address.toLowerCase();
  if (a.includes(':')) return a === '::1' || a.startsWith('fe80:') || a.startsWith('fc') ||
    a.startsWith('fd') || a.startsWith('::ffff:') || a === '::';
  const p = a.split('.').map(Number);
  return p.length !== 4 || p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    p[0] >= 224 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
export async function assertPublicWebUrl(raw: string, allowed: string[]): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !!u.port || !!u.username || !!u.password || !safeHostname(u.hostname, allowed))
    throw new Error('HOST_NOT_ALLOWED');
  const addresses = await lookup(u.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => isPrivate(a.address))) throw new Error('PRIVATE_ADDRESS_BLOCKED');
}
