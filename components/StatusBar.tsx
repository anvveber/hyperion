'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useIsOffline } from '@/hooks/useIsOffline';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatClock(date: Date, utc: boolean): string {
  const h = utc ? date.getUTCHours() : date.getHours();
  const m = utc ? date.getUTCMinutes() : date.getMinutes();
  const s = utc ? date.getUTCSeconds() : date.getSeconds();
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Ticking clock. Renders nothing until mounted so the server and the first
 * client render agree, then updates once a second.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  return now;
}

interface StatusBarProps {
  operator?: string;
}

/**
 * Bottom status strip of the console shell, shown on wide screens only:
 * connection state and who is signed in on the left, local and UTC clocks
 * on the right.
 */
export default function StatusBar({ operator }: StatusBarProps) {
  const t = useTranslations('nav.status');
  const isOffline = useIsOffline();
  const now = useNow();

  return (
    <div
      role="status"
      aria-live="off"
      className="hidden md:flex fixed bottom-0 inset-x-0 z-30 h-[var(--statusbar-h)] items-center justify-between gap-6 px-4 hy-navbar border-t border-border font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted tabular-nums"
    >
      <div className="flex items-center gap-5 min-w-0">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block w-1.5 h-1.5 rounded-full ${isOffline ? 'bg-warning' : 'bg-ok hy-pulse'}`}
          />
          <span className={isOffline ? 'text-warning' : 'text-foreground'}>
            {isOffline ? t('offline') : t('online')}
          </span>
        </span>
        {operator && (
          <span className="truncate">
            {t('operator')} <span className="text-foreground normal-case tracking-normal">{operator}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-5 shrink-0">
        {now && (
          <>
            <span>{formatIsoDate(now)}</span>
            <span>
              {t('local')} <span className="text-foreground">{formatClock(now, false)}</span>
            </span>
            <span>
              {t('utc')} <span className="text-foreground">{formatClock(now, true)}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
