import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, foldLine } from '@/lib/calendar/ics';
import type { CalendarEvent } from '@/lib/calendar/events';

const now = new Date(Date.UTC(2026, 9, 11, 7, 30, 0));

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'd1',
    personId: 'p1',
    personName: 'Anna Smith',
    title: 'Birthday',
    year: 1990,
    month: 4,
    day: 12,
    recurrence: { frequency: 'YEARLY', interval: 1 },
    ...overrides,
  };
}

function build(events: CalendarEvent[], appUrl?: string): string {
  return buildIcs(events, {
    calendarName: 'Important dates',
    summary: (e) => `${e.title}: ${e.personName}`,
    appUrl,
    now,
  });
}

describe('buildIcs', () => {
  it('writes a yearly all-day event with CRLF line endings', () => {
    const ics = build([event({})], 'https://example.com/');
    expect(ics.endsWith('\r\n')).toBe(true);
    const lines = ics.trimEnd().split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('UID:important-date-d1@nametag');
    expect(lines).toContain('DTSTAMP:20261011T073000Z');
    expect(lines).toContain('DTSTART;VALUE=DATE:19900512');
    expect(lines).toContain('DTEND;VALUE=DATE:19900513');
    expect(lines).toContain('SUMMARY:Birthday: Anna Smith');
    expect(lines).toContain('RRULE:FREQ=YEARLY');
    expect(lines).toContain('URL:https://example.com/people/p1');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
  });

  it('anchors year-unknown dates in 2000', () => {
    expect(build([event({ year: null })])).toContain('DTSTART;VALUE=DATE:20000512');
  });

  it('keeps a yearly Feb 29 visible in common years', () => {
    const ics = build([event({ year: 1996, month: 1, day: 29 })]);
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1');
    expect(ics).toContain('DTEND;VALUE=DATE:19960301');
  });

  it('writes the interval and leaves one-time events without an RRULE', () => {
    const ics = build([
      event({ id: 'a', recurrence: { frequency: 'MONTHLY', interval: 6 } }),
      event({ id: 'b', recurrence: null }),
    ]);
    expect(ics).toContain('RRULE:FREQ=MONTHLY;INTERVAL=6');
    expect(ics.match(/RRULE/g)).toHaveLength(1);
  });

  it('omits URL when no app URL is given', () => {
    expect(build([event({})])).not.toContain('URL:');
  });
});

describe('escapeText', () => {
  it('escapes backslashes, separators and newlines', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\;c\\,d\\ne');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets without splitting multi-byte characters', () => {
    const line = `SUMMARY:${'生日'.repeat(30)}`;
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const physical of folded.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split('\r\n').map((part, i) => (i === 0 ? part : part.slice(1))).join('')).toBe(line);
  });
});
