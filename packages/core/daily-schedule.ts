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

/**
 * The immediate first capture belongs to its own Beijing calendar day.
 * Start regular captures at 19:00 on the NEXT Beijing date, even if <24 hours
 * elapsed since the initial capture. Honor source intervals STRICTER than daily.
 * Legacy 86400 values are the old daily cadence defaults.
 */
export function nextBeijing1900AfterInterval(fromMs: number, intervalSeconds: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(intervalSeconds)) throw new Error('INVALID_SCHEDULE_TIME');
  const beijingDay = Math.floor((fromMs + 8 * 60 * 60 * 1000) / DAY_MS);
  const nextCalendarDayAt1900 = (beijingDay + 1) * DAY_MS + BEIJING_1900_UTC_MS;
  const stricterEarliest = intervalSeconds > 86400 ? fromMs + intervalSeconds * 1000 : nextCalendarDayAt1900;
  return nextBeijing1900AtOrAfter(Math.max(nextCalendarDayAt1900, stricterEarliest));
}

/** Beijing calendar date for a timestamp, independent of the host timezone. */
export function beijingDateKey(timestampMs:number):string{
 if(!Number.isFinite(timestampMs))throw new Error('INVALID_SCHEDULE_TIME');
 return new Date(timestampMs+8*60*60*1000).toISOString().slice(0,10);
}

/** The 19:00 Asia/Shanghai instant belonging to the timestamp's Beijing date. */
export function beijing1900ForTimestamp(timestampMs:number):number{
 const date=beijingDateKey(timestampMs);
 return Date.parse(date+'T11:00:00.000Z');
}
