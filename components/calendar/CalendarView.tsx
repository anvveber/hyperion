'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { daysInMonth, getEventDaysInMonth, type CalendarEvent } from '@/lib/calendar/events';

interface CalendarViewProps {
  events: CalendarEvent[];
}

interface MonthEntry {
  day: number;
  event: CalendarEvent;
}

function subscribeNever(): () => void {
  return () => {};
}

function getTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

function getServerTodayKey(): null {
  return null;
}

function parseDayKey(key: string | null): { year: number; month: number; day: number } | null {
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/** 2024-01-01 was a Monday; used to name the weekday columns. */
const MONDAY = new Date(2024, 0, 1);

export default function CalendarView({ events }: CalendarViewProps) {
  const t = useTranslations('calendar');
  const locale = useLocale();

  // "Today" depends on the viewer's clock, so the server renders without it
  // and the client fills it in after hydration.
  const todayKey = useSyncExternalStore(subscribeNever, getTodayKey, getServerTodayKey);
  const today = useMemo(() => parseDayKey(todayKey), [todayKey]);
  // null follows today's month until the user navigates away from it
  const [selected, setSelected] = useState<{ year: number; month: number } | null>(null);
  const view = useMemo(
    () => selected ?? (today ? { year: today.year, month: today.month } : null),
    [selected, today]
  );

  const entries = useMemo<MonthEntry[]>(() => {
    if (!view) return [];
    const list = events.flatMap((event) =>
      getEventDaysInMonth(event, view.year, view.month).map((day) => ({ day, event }))
    );
    list.sort((a, b) => a.day - b.day || a.event.personName.localeCompare(b.event.personName, locale));
    return list;
  }, [events, view, locale]);

  const weekdayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(MONDAY);
      date.setDate(MONDAY.getDate() + i);
      return format.format(date);
    });
  }, [locale]);

  const shiftMonth = (delta: number) => {
    if (!view) return;
    const date = new Date(view.year, view.month + delta, 1);
    setSelected({ year: date.getFullYear(), month: date.getMonth() });
  };

  const downloadIcs = () => {
    window.location.href = '/api/calendar/ics';
  };

  const header = (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>
      <Button onClick={downloadIcs} disabled={events.length === 0}>
        {t('downloadIcs')}
      </Button>
    </div>
  );

  if (!view) {
    return header;
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(view.year, view.month, 1)
  );
  const totalDays = daysInMonth(view.year, view.month);
  // Monday-first column of the 1st: getDay() is 0 for Sunday.
  const leadingBlanks = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const entriesByDay = new Map<number, MonthEntry[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.day) ?? [];
    list.push(entry);
    entriesByDay.set(entry.day, list);
  }

  const isToday = (day: number) =>
    today !== null && today.year === view.year && today.month === view.month && today.day === day;

  const dayLabel = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).format(
      new Date(view.year, view.month, day)
    );

  const navButton = 'p-2 rounded-md text-muted hover:text-foreground hover:bg-surface-elevated transition-colors focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <>
      {header}

      {events.length === 0 && (
        <p className="mb-6 text-sm text-muted">{t('empty')}</p>
      )}

      <section className="bg-surface border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button type="button" onClick={() => shiftMonth(-1)} className={navButton} aria-label={t('previousMonth')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground" aria-live="polite">
              {monthLabel}
            </h2>
            {today && (today.year !== view.year || today.month !== view.month) && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="font-mono text-xs uppercase tracking-wider text-muted hover:text-foreground underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
              >
                {t('today')}
              </button>
            )}
          </div>
          <button type="button" onClick={() => shiftMonth(1)} className={navButton} aria-label={t('nextMonth')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-border" aria-hidden="true">
          {weekdayNames.map((name) => (
            <div key={name} className="px-2 py-2 text-center font-mono text-[11px] uppercase tracking-wider text-muted">
              {name}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7" aria-hidden="true">
          {cells.map((day, index) => {
            const dayEntries = day ? entriesByDay.get(day) ?? [] : [];
            return (
              <div
                key={index}
                className={`min-h-14 sm:min-h-24 p-1 sm:p-1.5 border-border ${index % 7 !== 6 ? 'border-r' : ''} ${index < cells.length - 7 ? 'border-b' : ''}`}
              >
                {day && (
                  <>
                    <div
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-mono text-xs ${
                        isToday(day) ? 'bg-primary text-on-primary font-semibold' : 'text-muted'
                      }`}
                    >
                      {day}
                    </div>
                    {/* Names on wider screens, a count on phones */}
                    <ul className="hidden sm:block mt-1 space-y-0.5">
                      {dayEntries.slice(0, 3).map(({ event }) => (
                        <li key={event.id} className="truncate text-xs text-foreground" title={`${event.personName}: ${event.title}`}>
                          {event.personName}
                        </li>
                      ))}
                      {dayEntries.length > 3 && (
                        <li className="text-xs text-muted">{t('more', { count: dayEntries.length - 3 })}</li>
                      )}
                    </ul>
                    {dayEntries.length > 0 && (
                      <div className="sm:hidden mt-1 flex justify-center">
                        <span className="min-w-5 h-5 px-1 inline-flex items-center justify-center rounded-full bg-badge-bg text-badge-text font-mono text-[10px]">
                          {dayEntries.length}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="sr-only">{monthLabel}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">{t('noDatesThisMonth')}</p>
        ) : (
          <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
            {entries.map(({ day, event }) => (
              <li key={`${event.id}-${day}`} className="flex items-center gap-4 px-4 py-3">
                <span className={`w-16 shrink-0 font-mono text-xs uppercase tracking-wider ${isToday(day) ? 'text-foreground font-semibold' : 'text-muted'}`}>
                  {dayLabel(day)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/people/${event.personId}`} className="block truncate text-sm font-medium text-foreground hover:underline underline-offset-4">
                    {event.personName}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {event.title}
                    {event.recurrence?.frequency === 'YEARLY' && event.year !== null && view.year > event.year && (
                      <> · {t('yearsSince', { count: view.year - event.year })}</>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
