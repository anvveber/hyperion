import { describe, it, expect } from 'vitest';
import { getCalendarRecurrence, getEventDaysInMonth, type CalendarEvent } from '@/lib/calendar/events';

const base = {
  type: null,
  reminderType: null,
  reminderInterval: null,
  reminderIntervalUnit: null,
} as const;

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'd1',
    personId: 'p1',
    personName: 'Anna',
    title: 'Birthday',
    year: 1990,
    month: 4,
    day: 12,
    recurrence: { frequency: 'YEARLY', interval: 1 },
    ...overrides,
  };
}

describe('getCalendarRecurrence', () => {
  it('makes predefined types yearly whatever the reminder says', () => {
    expect(
      getCalendarRecurrence({ ...base, type: 'birthday', reminderType: 'ONCE' }, false)
    ).toEqual({ frequency: 'YEARLY', interval: 1 });
  });

  it('makes year-unknown dates yearly', () => {
    expect(
      getCalendarRecurrence({ ...base, reminderType: 'RECURRING', reminderInterval: 2, reminderIntervalUnit: 'MONTHS' }, true)
    ).toEqual({ frequency: 'YEARLY', interval: 1 });
  });

  it('follows a custom date\'s recurring reminder', () => {
    expect(
      getCalendarRecurrence({ ...base, reminderType: 'RECURRING', reminderInterval: 6, reminderIntervalUnit: 'MONTHS' }, false)
    ).toEqual({ frequency: 'MONTHLY', interval: 6 });
  });

  it('makes a custom date with a one-time reminder a single event', () => {
    expect(getCalendarRecurrence({ ...base, reminderType: 'ONCE' }, false)).toBeNull();
  });

  it('makes a custom date without a reminder yearly', () => {
    expect(getCalendarRecurrence(base, false)).toEqual({ frequency: 'YEARLY', interval: 1 });
  });
});

describe('getEventDaysInMonth', () => {
  it('places a yearly date in its month every year from its start', () => {
    const e = event({});
    expect(getEventDaysInMonth(e, 2026, 4)).toEqual([12]);
    expect(getEventDaysInMonth(e, 2026, 5)).toEqual([]);
    expect(getEventDaysInMonth(e, 1989, 4)).toEqual([]);
  });

  it('places a year-unknown date in every year', () => {
    expect(getEventDaysInMonth(event({ year: null }), 1500, 4)).toEqual([12]);
  });

  it('moves a yearly Feb 29 to Feb 28 in common years', () => {
    const e = event({ year: 2000, month: 1, day: 29 });
    expect(getEventDaysInMonth(e, 2027, 1)).toEqual([28]);
    expect(getEventDaysInMonth(e, 2028, 1)).toEqual([29]);
  });

  it('respects a yearly interval', () => {
    const e = event({ year: 2020, recurrence: { frequency: 'YEARLY', interval: 2 } });
    expect(getEventDaysInMonth(e, 2022, 4)).toEqual([12]);
    expect(getEventDaysInMonth(e, 2023, 4)).toEqual([]);
  });

  it('shows a one-time event only in its own month', () => {
    const e = event({ year: 2026, recurrence: null });
    expect(getEventDaysInMonth(e, 2026, 4)).toEqual([12]);
    expect(getEventDaysInMonth(e, 2027, 4)).toEqual([]);
  });

  it('skips months too short for a monthly date', () => {
    const e = event({ year: 2026, month: 0, day: 31, recurrence: { frequency: 'MONTHLY', interval: 1 } });
    expect(getEventDaysInMonth(e, 2026, 1)).toEqual([]);
    expect(getEventDaysInMonth(e, 2026, 2)).toEqual([31]);
  });

  it('repeats a weekly date on every matching day of the month', () => {
    const e = event({ year: 2026, month: 9, day: 1, recurrence: { frequency: 'WEEKLY', interval: 2 } });
    expect(getEventDaysInMonth(e, 2026, 9)).toEqual([1, 15, 29]);
    expect(getEventDaysInMonth(e, 2026, 8)).toEqual([]);
  });
});
