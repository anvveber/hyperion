import { env } from '@/lib/env';

/**
 * Number of days soft-deleted items are kept before the purge-deleted cron
 * removes them, or null when TRASH_RETENTION_DAYS is "never" (the default).
 */
export function getTrashRetentionDays(): number | null {
  const value = env.TRASH_RETENTION_DAYS;
  return typeof value === 'number' ? value : null;
}

/**
 * Items deleted before this date are due for purging. Null when nothing is
 * ever purged.
 */
export function getTrashCutoffDate(now: Date = new Date()): Date | null {
  const days = getTrashRetentionDays();
  if (days === null) return null;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}
