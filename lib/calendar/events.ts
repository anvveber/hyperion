import { isPredefinedType } from '@/lib/important-date-types';
import { YEAR_UNKNOWN_SENTINEL } from '@/lib/date-format';

/**
 * Calendar view of important dates, shared by the calendar page and the .ics
 * export. Kept free of server imports so client components can use it.
 */

export type CalendarFrequency = 'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY';

export interface CalendarRecurrence {
  frequency: CalendarFrequency;
  interval: number;
}

export interface CalendarEvent {
  id: string;
  personId: string;
  personName: string;
  title: string;
  /** null when the year is unknown */
  year: number | null;
  /** 0-11 */
  month: number;
  day: number;
  /** null for a one-time event */
  recurrence: CalendarRecurrence | null;
}

interface RecurrenceSource {
  type: string | null;
  reminderType: 'ONCE' | 'RECURRING' | null;
  reminderInterval: number | null;
  reminderIntervalUnit: 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS' | null;
}

const UNIT_TO_FREQUENCY: Record<NonNullable<RecurrenceSource['reminderIntervalUnit']>, CalendarFrequency> = {
  DAYS: 'DAILY',
  WEEKS: 'WEEKLY',
  MONTHS: 'MONTHLY',
  YEARS: 'YEARLY',
};

const YEARLY: CalendarRecurrence = { frequency: 'YEARLY', interval: 1 };

/**
 * How an important date repeats on the calendar.
 *
 * Birthdays, anniversaries, name days and memorials, and every date without a
 * known year, come round once a year whatever their reminder says: the
 * reminder cadence is about notifications, not about the date itself. A
 * custom date follows its recurring reminder, is a single event when its
 * reminder fires only once, and is yearly when it has no reminder at all.
 */
export function getCalendarRecurrence(
  date: RecurrenceSource,
  yearUnknown: boolean
): CalendarRecurrence | null {
  if (yearUnknown || (date.type && isPredefinedType(date.type))) {
    return YEARLY;
  }
  if (date.reminderType === 'ONCE') {
    return null;
  }
  if (date.reminderType === 'RECURRING' && date.reminderIntervalUnit) {
    return {
      frequency: UNIT_TO_FREQUENCY[date.reminderIntervalUnit],
      interval: Math.max(1, date.reminderInterval ?? 1),
    };
  }
  return YEARLY;
}

/** Split a calendar date (already anchored with parseCalendarDate) into its parts. */
export function toCalendarParts(date: Date): Pick<CalendarEvent, 'year' | 'month' | 'day'> {
  const year = date.getFullYear();
  return {
    year: year <= YEAR_UNKNOWN_SENTINEL ? null : year,
    month: date.getMonth(),
    day: date.getDate(),
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Whole-day number, immune to DST because it is computed in UTC. */
function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / 86_400_000);
}

/**
 * Days of the given month (1-based) on which the event falls.
 *
 * Mirrors what calendar apps do with the RRULE written by the .ics export:
 * a yearly Feb 29 falls on Feb 28 in common years (BYMONTHDAY=-1), and a
 * monthly date skips months that are too short for it, as RFC 5545 requires.
 */
export function getEventDaysInMonth(event: CalendarEvent, year: number, month: number): number[] {
  const { recurrence } = event;
  const lastDay = daysInMonth(year, month);

  if (!recurrence) {
    return event.year === year && event.month === month ? [event.day] : [];
  }

  const startYear = event.year;
  const { frequency, interval } = recurrence;

  if (frequency === 'YEARLY') {
    if (month !== event.month) return [];
    if (startYear !== null) {
      const elapsed = year - startYear;
      if (elapsed < 0 || elapsed % interval !== 0) return [];
    }
    return [Math.min(event.day, lastDay)];
  }

  // Only yearly events can lack a year (see getCalendarRecurrence).
  if (startYear === null) return [];

  if (frequency === 'MONTHLY') {
    const elapsed = (year * 12 + month) - (startYear * 12 + event.month);
    if (elapsed < 0 || elapsed % interval !== 0 || event.day > lastDay) return [];
    return [event.day];
  }

  const step = frequency === 'WEEKLY' ? interval * 7 : interval;
  const start = dayNumber(startYear, event.month, event.day);
  const days: number[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const elapsed = dayNumber(year, month, day) - start;
    if (elapsed >= 0 && elapsed % step === 0) {
      days.push(day);
    }
  }
  return days;
}
