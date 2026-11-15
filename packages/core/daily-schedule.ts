/** 19:00 Asia/Shanghai is always 11:00 UTC (China has no DST). */
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_1900_UTC_MS = 11 * 60 * 60 * 1000;

/** Next Beijing 19:00 at or after the requested instant. */
export function nextBeijing1900AtOrAfter(earliestMs: number): number {
  if (!Number.isFinite(earliestMs)) throw new Error('INVALID_SCHEDULE_TIME');
  const utcMidnight = Math.floor(earliestMs / DAY_MS) * DAY_MS;
  const todayAt1900 = utcMidnight + BEIJING_1900_UTC_MS;
  return earliestMs <= todayAt1900 ? todayAt1900 : todayAt1900 + DAY_MS;
}

/** Strictly future daily 19:00 slot. */
export function nextBeijing1900After(nowMs: number): number {
  return nextBeijing1900AtOrAfter(nowMs + 1);
}

/** First regular run after an immediate collection; honor stricter source limits. */
export function nextBeijing1900AfterInterval(fromMs: number, intervalSeconds: number): number {
  const seconds = Math.max(86400, intervalSeconds);
  return nextBeijing1900AtOrAfter(fromMs + seconds * 1000);
}
