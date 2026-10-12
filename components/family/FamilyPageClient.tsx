'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import type { FamilyMapPoint } from './FamilyMap';
import { formatRelativeFromNow, isRecentPosition } from '@/lib/relative-time';

interface Position {
  lat: number;
  lon: number;
  tst: number;
  acc: number | null;
  batt: number | null;
}

interface Member {
  id: string;
  name: string;
  isMe: boolean;
  position: Position | null;
}

interface FamilyData {
  enabled: boolean;
  canView: boolean;
  isAdmin: boolean;
  members: Member[];
}

const FamilyMap = dynamic(() => import('./FamilyMap'), { ssr: false });

const REFRESH_MS = 60_000;

export default function FamilyPageClient() {
  const t = useTranslations('family');
  const locale = useLocale();
  const [data, setData] = useState<FamilyData | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/family', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as FamilyData);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setNow(Date.now());
    }
  }, []);

  // Load now and every minute while the page is open and visible.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const points: FamilyMapPoint[] = useMemo(
    () =>
      (data?.members ?? [])
        .filter((m) => m.position)
        .map((m) => ({
          id: m.id,
          name: m.name,
          lat: m.position!.lat,
          lon: m.position!.lon,
          acc: m.position!.acc,
          stale: !isRecentPosition(m.position!.tst, now),
          isMe: m.isMe,
        })),
    [data, now]
  );

  const title = <h1 className="text-3xl font-bold text-foreground mb-2">{t('title')}</h1>;

  if (!data) {
    return (
      <div>
        {title}
        <p className="text-muted">{failed ? t('loadFailed') : t('loading')}</p>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div>
        {title}
        <div className="bg-surface border border-border rounded-lg p-6 text-muted">{t('notConfigured')}</div>
      </div>
    );
  }

  if (!data.canView) {
    return (
      <div>
        {title}
        <div className="bg-surface border border-border rounded-lg p-6 space-y-3">
          <p className="text-foreground">{t('notSharing')}</p>
          <p className="text-sm text-muted">{t('notSharingWhy')}</p>
          {data.isAdmin && (
            <Link href="/settings/family" className="inline-block text-sm text-primary hover:underline">
              {t('manage')}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          {title}
          <p className="text-muted">{t('description')}</p>
        </div>
        {data.isAdmin && (
          <Link href="/settings/family" className="text-sm text-primary hover:underline">
            {t('manage')}
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
        <div className="bg-surface border border-border rounded-lg p-4">
          {points.length > 0 ? (
            <FamilyMap points={points} height={520} ariaLabel={t('mapLabel')} />
          ) : (
            <p className="text-sm text-muted py-16 text-center">{t('noPositions')}</p>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg p-4">
          <h2 className="text-lg font-semibold text-foreground mb-3">{t('members')}</h2>
          <ul className="divide-y divide-border">
            {data.members.map((m) => {
              const recent = m.position ? isRecentPosition(m.position.tst, now) : false;
              return (
                <li key={m.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {m.name}
                      {m.isMe && <span className="ml-2 text-xs font-mono uppercase tracking-wider text-muted">{t('you')}</span>}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`inline-block w-2 h-2 rounded-full ${m.position ? (recent ? 'bg-primary' : 'bg-muted') : 'bg-border'}`}
                    />
                  </div>
                  {m.position ? (
                    <p className={`text-xs font-mono mt-1 ${recent ? 'text-muted' : 'text-warning'}`}>
                      {formatRelativeFromNow(m.position.tst, locale, now)}
                      {m.position.acc !== null && ` · ±${Math.round(m.position.acc)} m`}
                      {m.position.batt !== null && ` · ${t('battery', { level: Math.round(m.position.batt) })}`}
                    </p>
                  ) : (
                    <p className="text-xs text-muted mt-1">{t('noPositionYet')}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">{t('privacyNote')}</p>
        </div>
      </div>
    </div>
  );
}
