export type Precision = 'exact' | 'lower_bound' | 'approximate' | 'missing';
export type Sales = { raw: string | null; value: number | null; precision: Precision };
export type Price = { raw: string | null; cents: number | null; kind: 'exact' | 'starting_from' | 'missing' };

export function parseSales(input: string | null | undefined): Sales {
  const raw = input?.trim() || null;
  if (!raw) return { raw, value: null, precision: 'missing' };
  const match = raw.replace(/,/g, '').match(/(?:已售|销量|售出|sold)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(亿|万|千|k|K|w|W)?\s*(\+|＋|以上|余)?/i);
  if (!match) return { raw, value: null, precision: 'missing' };
  const factor: Record<string, number> = { 亿: 100000000, 万: 10000, 千: 1000, k: 1000, w: 10000 };
  const magnitude = factor[match[2]?.toLowerCase()] ?? 1;
  const value = Math.round(Number(match[1]) * magnitude);
  if (!Number.isSafeInteger(value) || value < 0) return { raw, value: null, precision: 'missing' };
  const hasPlus = !!match[3] || /[+＋]/.test(raw);
  return { raw, value, precision: hasPlus ? 'lower_bound' : magnitude !== 1 ? 'approximate' : 'exact' };
}

export function parsePrice(input: string | null | undefined): Price {
  const raw = input?.trim() || null;
  if (!raw) return { raw, cents: null, kind: 'missing' };
  const match = raw.replace(/,/g, '').match(/(?:¥|￥|RMB|CNY)\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match) return { raw, cents: null, kind: 'missing' };
  const cents = Math.round(Number(match[1]) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return { raw, cents: null, kind: 'missing' };
  return { raw, cents, kind: /起|from|starting/i.test(raw) ? 'starting_from' : 'exact' };
}

export function compareSales(
  previous: { value: number | null; precision: Precision; scope: string; sourceId: string },
  current: { value: number | null; precision: Precision; scope: string; sourceId: string }
): { kind: 'exact_display_delta' | 'threshold_changed' | 'not_comparable'; delta: number | null } {
  if (previous.sourceId !== current.sourceId || previous.scope !== current.scope ||
      previous.value === null || current.value === null) return { kind: 'not_comparable', delta: null };
  if (previous.precision === 'exact' && current.precision === 'exact')
    return { kind: 'exact_display_delta', delta: current.value - previous.value };
  if (previous.value !== current.value) return { kind: 'threshold_changed', delta: null };
  return { kind: 'not_comparable', delta: null };
}
