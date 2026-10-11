import type { CalendarEvent } from './events';

/**
 * Minimal RFC 5545 writer for important dates. Every event is an all-day
 * event; recurring dates carry an RRULE so a calendar app shows them every
 * year (or month, week, day) without the file listing each occurrence.
 */

export interface IcsOptions {
  calendarName: string;
  /** Builds the SUMMARY line for one event */
  summary: (event: CalendarEvent) => string;
  /** Base URL of this instance; adds a link to the person when set */
  appUrl?: string;
  now?: Date;
}

/**
 * Year written as DTSTART for dates whose year is unknown. A leap year, so a
 * year-unknown Feb 29 keeps its day; recent enough that every calendar app
 * expands it (some struggle with Apple's 1604 marker).
 */
const UNKNOWN_YEAR_ANCHOR = 2000;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}${pad(month + 1)}${pad(day)}`;
}

function formatTimestamp(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Escape a TEXT value (RFC 5545 section 3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to at most 75 octets per physical line (RFC 5545
 * section 3.1), never splitting a multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  // Continuation lines start with a space, which counts toward their 75.
  let limit = 75;

  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function buildRrule(event: CalendarEvent): string | null {
  const { recurrence } = event;
  if (!recurrence) return null;

  const parts = [`FREQ=${recurrence.frequency}`];
  if (recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`);
  }
  // A plain yearly Feb 29 only fires in leap years. Pin it to the last day of
  // February so it shows up on Feb 28 the other three years.
  if (recurrence.frequency === 'YEARLY' && event.month === 1 && event.day === 29) {
    parts.push('BYMONTH=2', 'BYMONTHDAY=-1');
  }
  return `RRULE:${parts.join(';')}`;
}

function buildEvent(event: CalendarEvent, options: IcsOptions, stamp: string): string[] {
  const year = event.year ?? UNKNOWN_YEAR_ANCHOR;
  const start = new Date(Date.UTC(year, event.month, event.day));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const lines = [
    'BEGIN:VEVENT',
    `UID:important-date-${event.id}@nametag`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${formatDate(year, event.month, event.day)}`,
    `DTEND;VALUE=DATE:${formatDate(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())}`,
    `SUMMARY:${escapeText(options.summary(event))}`,
  ];

  const rrule = buildRrule(event);
  if (rrule) lines.push(rrule);

  if (options.appUrl) {
    lines.push(`URL:${options.appUrl.replace(/\/+$/, '')}/people/${event.personId}`);
  }

  lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  return lines;
}

export function buildIcs(events: CalendarEvent[], options: IcsOptions): string {
  const stamp = formatTimestamp(options.now ?? new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nametag//Important dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    ...events.flatMap((event) => buildEvent(event, options, stamp)),
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}
