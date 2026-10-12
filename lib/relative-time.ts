/** Positions older than this are shown as not recent. */
export const RECENT_POSITION_SECONDS = 2 * 60 * 60;

/**
 * "3 minutes ago", "2 hours ago", "yesterday" in the given locale, for a
 * Unix timestamp in seconds. Times in the future (clock skew) read as now.
 */
export function formatRelativeFromNow(tstSeconds: number, locale: string, nowMs: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = Math.max(0, Math.round(nowMs / 1000 - tstSeconds));
  if (diff < 60) return rtf.format(0, 'second');
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  return rtf.format(-Math.floor(diff / 86400), 'day');
}

export function isRecentPosition(tstSeconds: number, nowMs: number = Date.now()): boolean {
  return nowMs / 1000 - tstSeconds <= RECENT_POSITION_SECONDS;
}
