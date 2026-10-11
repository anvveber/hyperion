'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from './ui/Modal';
import { Button } from './ui/Button';
import { formatDate, parseCalendarDate, type DateFormat } from '@/lib/date-format';

export interface LibraryMonth {
  year: string;
  month: string;
  count: number;
}

interface LibraryRow {
  path: string;
  name: string;
  recordedAt: string | null;
  durationMs: number | null;
  hasTranscript?: boolean;
  preview?: string | null;
  snippet?: string;
}

export interface LibraryAddedAudio {
  id: string;
  originalName: string;
  recordedAt: string | null;
  size: number;
  createdAt: string;
  sourcePath: string | null;
  transcriptLanguage: string | null;
  durationMs: number | null;
  hasTranscript: boolean;
}

interface RecordingsLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  personId: string;
  dateFormat: DateFormat;
  months: LibraryMonth[];
  searchable: boolean;
  existingPaths: Set<string>;
  onAdded: (audio: LibraryAddedAudio[]) => void;
}

const MAX_SELECTION = 20;

function previewUrl(rel: string): string {
  return `/api/recordings-library/audio?path=${encodeURIComponent(rel)}`;
}

// Recording times are the wall-clock time from the file name, stored as UTC.
function formatWhen(value: string | null, dateFormat: DateFormat): string | null {
  if (!value) return null;
  const d = new Date(value);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(parseCalendarDate(d), dateFormat)} ${hh}:${mm}`;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Search snippets mark matches with \u0002 and \u0003; render those as <mark>. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('\u0002') ? (
          <mark key={i} className="bg-primary/25 text-foreground px-0.5">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function RecordingsLibraryPicker({
  isOpen,
  onClose,
  personId,
  dateFormat,
  months,
  searchable,
  existingPaths,
  onAdded,
}: RecordingsLibraryPickerProps) {
  const t = useTranslations('people.audio.library');
  const tAudio = useTranslations('people.audio');
  const locale = useLocale();

  const [month, setMonth] = useState<string | null>(null);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const monthLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return (m: LibraryMonth) => fmt.format(new Date(Date.UTC(Number(m.year), Number(m.month) - 1, 1)));
  }, [locale]);

  // Start on the newest month each time the picker opens.
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setPreviewing(null);
    setActiveQuery(null);
    setQuery('');
    setMonth(months[0] ? `${months[0].year}/${months[0].month}` : null);
  }, [isOpen, months]);

  // Load the month being browsed, or the search results.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setPreviewing(null);
      try {
        if (activeQuery) {
          const res = await fetch(`/api/recordings-library/search?q=${encodeURIComponent(activeQuery)}`);
          if (res.status === 400) {
            if (!cancelled) {
              toast.error(t('searchFailed'));
              setRows([]);
            }
            return;
          }
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { hits: LibraryRow[] };
          if (!cancelled) setRows(data.hits);
        } else if (month) {
          const [year, mm] = month.split('/');
          const res = await fetch(`/api/recordings-library/month?year=${year}&month=${mm}`);
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { recordings: LibraryRow[] };
          if (!cancelled) setRows(data.recordings);
        } else if (!cancelled) {
          setRows([]);
        }
      } catch {
        if (!cancelled) toast.error(t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, month, activeQuery, t]);

  const toggle = (rel: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) {
        next.delete(rel);
      } else if (next.size >= MAX_SELECTION) {
        toast.error(t('maxSelection', { max: MAX_SELECTION }));
      } else {
        next.add(rel);
      }
      return next;
    });
  };

  const add = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/people/${personId}/audio/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [...selected] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        audio: LibraryAddedAudio[];
        results: { path: string; outcome: 'added' | 'alreadyAdded' | 'notFound' | 'failed' }[];
      };
      onAdded(data.audio);
      const added = data.results.filter((r) => r.outcome === 'added').length;
      const skipped = data.results.filter((r) => r.outcome === 'alreadyAdded').length;
      const failed = data.results.length - added - skipped;
      if (added > 0) toast.success(tAudio('uploadSuccess', { count: added }));
      if (skipped > 0) toast.info(t('skipped', { count: skipped }));
      if (failed > 0) toast.error(t('someFailed', { count: failed }));
      if (failed === 0) onClose();
      setSelected(new Set());
    } catch {
      toast.error(t('addFailed'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('title')} size="xl" closeAriaLabel={tAudio('cancel')}>
      <div className="space-y-4">
        {searchable && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = query.trim();
              setActiveQuery(q || null);
            }}
          >
            <div className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="flex-1 min-w-0 px-3 py-2 bg-surface-elevated border border-border rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button type="submit" variant="secondary" size="sm">
                {t('search')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted">{t('searchHint')}</p>
          </form>
        )}

        <div className="flex flex-col md:flex-row gap-4">
          {/* Months */}
          <div className="md:w-48 shrink-0">
            {activeQuery ? (
              <button
                type="button"
                onClick={() => {
                  setActiveQuery(null);
                  setQuery('');
                }}
                className="text-sm text-primary hover:underline"
              >
                {t('backToMonths')}
              </button>
            ) : (
              <>
                <label htmlFor="library-month" className="md:hidden block mb-1 text-muted">
                  {t('months')}
                </label>
                <select
                  id="library-month"
                  value={month ?? ''}
                  onChange={(e) => setMonth(e.target.value)}
                  className="md:hidden w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-foreground"
                >
                  {months.map((m) => (
                    <option key={`${m.year}/${m.month}`} value={`${m.year}/${m.month}`}>
                      {monthLabel(m)} ({m.count})
                    </option>
                  ))}
                </select>
                <ul className="hidden md:block max-h-[50vh] overflow-y-auto border border-border rounded-lg" aria-label={t('months')}>
                  {months.map((m) => {
                    const key = `${m.year}/${m.month}`;
                    const active = key === month;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setMonth(key)}
                          aria-current={active ? 'true' : undefined}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                            active ? 'bg-surface-elevated text-foreground font-medium' : 'text-muted hover:text-foreground hover:bg-surface-elevated/60'
                          }`}
                        >
                          <span className="capitalize">{monthLabel(m)}</span>
                          <span className="font-mono text-xs tabular-nums">{m.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* Recordings */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <p className="text-sm text-muted py-6">{t('loading')}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted py-6">{activeQuery ? t('noResults') : t('emptyMonth')}</p>
            ) : (
              <ul className="divide-y divide-border max-h-[50vh] overflow-y-auto border border-border rounded-lg">
                {rows.map((row) => {
                  const already = existingPaths.has(row.path);
                  const checked = selected.has(row.path);
                  const when = formatWhen(row.recordedAt, dateFormat);
                  const duration = formatDuration(row.durationMs);
                  const isPreviewing = previewing === row.path;
                  const text = row.snippet ?? row.preview ?? null;
                  return (
                    <li key={row.path} className={`px-3 py-2 ${checked ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked || already}
                          disabled={already}
                          onChange={() => toggle(row.path)}
                          aria-label={row.name}
                          className="mt-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono text-sm text-foreground">{when ?? row.name}</span>
                            {duration && <span className="font-mono text-xs text-muted">{duration}</span>}
                            {already ? (
                              <span className="text-xs font-mono uppercase tracking-wider text-muted">{t('alreadyAdded')}</span>
                            ) : row.hasTranscript === false ? (
                              <span className="text-xs font-mono uppercase tracking-wider text-muted">{t('noTranscript')}</span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted font-mono truncate">{row.name}</p>
                          {text && (
                            <p className="mt-1 text-sm text-foreground/90 line-clamp-2">
                              <Snippet text={text} />
                            </p>
                          )}
                          {isPreviewing && (
                            <audio
                              src={previewUrl(row.path)}
                              controls
                              autoPlay
                              preload="metadata"
                              className="mt-2 w-full dark:[color-scheme:dark]"
                              aria-label={row.name}
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewing(isPreviewing ? null : row.path)}
                          className="shrink-0 p-2 rounded-full border border-border text-foreground hover:bg-surface-elevated transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          aria-label={isPreviewing ? t('stopPreview', { name: row.name }) : t('preview', { name: row.name })}
                          title={isPreviewing ? t('stopPreview', { name: row.name }) : t('preview', { name: row.name })}
                        >
                          {isPreviewing ? (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="6" y="6" width="12" height="12" rx="1" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <span className="text-sm text-muted">{t('selected', { count: selected.size })}</span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={adding}>
              {tAudio('cancel')}
            </Button>
            <Button type="button" size="sm" onClick={add} disabled={adding || selected.size === 0}>
              {adding ? t('adding') : t('addSelected', { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
