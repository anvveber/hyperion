'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { FamilyMapPoint } from './FamilyMap';
import { formatRelativeFromNow, isRecentPosition } from '@/lib/relative-time';

const FamilyMap = dynamic(() => import('./FamilyMap'), { ssr: false });

interface Position {
  lat: number;
  lon: number;
  tst: number;
  acc: number | null;
  batt: number | null;
}

interface LocationData {
  enabled: boolean;
  canView: boolean;
  member: { id: string; name: string } | null;
  position: Position | null;
  recorderReachable?: boolean;
  options: { id: string; name: string }[];
}

const REFRESH_MS = 60_000;
const SELECT =
  'flex-1 min-w-0 px-2 py-1 border border-border rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary';
const BUTTON =
  'px-3 py-1 text-sm border border-border rounded-lg text-foreground hover:bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50';

/**
 * Shared location of the family member this person is linked to, as a small
 * map. Renders nothing unless location sharing is configured and the viewer
 * shares their own location.
 */
export default function PersonLocation({ personId }: { personId: string }) {
  const t = useTranslations('people.location');
  const locale = useLocale();
  const [data, setData] = useState<LocationData | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/people/${personId}/location`, { cache: 'no-store' });
      if (!res.ok) return;
      setData((await res.json()) as LocationData);
    } catch {
      // Leave the panel as it was; it is not essential to the page.
    } finally {
      setNow(Date.now());
    }
  }, [personId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const save = async (familyMemberId: string | null) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${personId}/location`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyMemberId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(familyMemberId ? t('linked') : t('unlinked'));
      setChoice('');
      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const points: FamilyMapPoint[] = useMemo(() => {
    if (!data?.member || !data.position) return [];
    const p = data.position;
    return [{ id: data.member.id, name: data.member.name, lat: p.lat, lon: p.lon, acc: p.acc, stale: !isRecentPosition(p.tst, now) }];
  }, [data, now]);

  if (!data || !data.enabled || !data.canView) return null;

  const position = data.position;

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-lg font-semibold text-foreground">{t('title')}</h3>
        <Link href="/family" className="text-sm text-primary hover:underline">
          {t('openFamily')}
        </Link>
      </div>

      {data.member ? (
        <>
          {data.recorderReachable === false ? (
            <p className="text-sm text-warning mb-2">{t('recorderUnreachable')}</p>
          ) : !position ? (
            <p className="text-sm text-muted mb-2">{t('noPositionYet', { name: data.member.name })}</p>
          ) : (
            <>
              <FamilyMap points={points} height={200} compact ariaLabel={t('mapLabel', { name: data.member.name })} />
              <p className="text-xs text-muted mt-2 font-mono">
                {t('updated', { time: formatRelativeFromNow(position.tst, locale, now) })}
                {position.acc !== null && ` · ${t('accuracy', { meters: Math.round(position.acc) })}`}
                {position.batt !== null && ` · ${t('battery', { level: Math.round(position.batt) })}`}
              </p>
            </>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">{t('linkedTo', { name: data.member.name })}</span>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void save(null)}>
              {t('unlink')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted mb-2">{t('notLinked')}</p>
          <div className="flex items-center gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label={t('chooseMember')}
              className={SELECT}
              disabled={busy || data.options.length === 0}
            >
              <option value="">{t('chooseMember')}</option>
              {data.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button type="button" className={BUTTON} disabled={busy || !choice} onClick={() => void save(choice)}>
              {t('link')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
