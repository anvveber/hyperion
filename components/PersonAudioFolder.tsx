'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from './ui/Button';
import ConfirmationModal from './ui/ConfirmationModal';
import { formatDate, parseCalendarDate, type DateFormat } from '@/lib/date-format';

interface PersonAudio {
  id: string;
  originalName: string;
  recordedAt: string | null;
  size: number;
  createdAt: string;
}

interface PersonAudioFolderProps {
  personId: string;
  dateFormat: DateFormat;
}

function audioUrl(personId: string, audioId: string, download = false): string {
  return `/api/people/${personId}/audio/${audioId}${download ? '?download=1' : ''}`;
}

// Same order as the API: newest recording first, undated files last
function compareAudio(a: PersonAudio, b: PersonAudio): number {
  if (a.recordedAt && b.recordedAt && a.recordedAt !== b.recordedAt) {
    return a.recordedAt < b.recordedAt ? 1 : -1;
  }
  if (a.recordedAt && !b.recordedAt) return -1;
  if (!a.recordedAt && b.recordedAt) return 1;
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

// recordedAt holds the wall-clock time from the filename as UTC, so read it back with UTC getters
function formatRecordedAt(value: string, dateFormat: DateFormat): string {
  const d = new Date(value);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(parseCalendarDate(d), dateFormat)} ${hours}:${minutes}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PersonAudioFolder({ personId, dateFormat }: PersonAudioFolderProps) {
  const t = useTranslations('people.audio');
  const [audio, setAudio] = useState<PersonAudio[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}/audio`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { audio: PersonAudio[] }) => {
        if (!cancelled) setAudio(data.audio);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, t]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    let failed = 0;
    setUploading({ done: 0, total: files.length });

    // Upload one at a time so each request stays under the body size limit
    for (const [i, file] of files.entries()) {
      try {
        const formData = new FormData();
        formData.append('audio', file, file.name);
        const res = await fetch(`/api/people/${personId}/audio`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { audio: PersonAudio };
        setAudio((prev) => [...prev, data.audio].sort(compareAudio));
      } catch {
        failed += 1;
      }
      setUploading({ done: i + 1, total: files.length });
    }

    setUploading(null);
    if (inputRef.current) inputRef.current.value = '';
    if (failed > 0) {
      toast.error(t('uploadFailed', { count: failed }));
    } else {
      toast.success(t('uploadSuccess', { count: files.length }));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/people/${personId}/audio/${pendingDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setAudio((prev) => prev.filter((item) => item.id !== pendingDelete));
      if (playingId === pendingDelete) setPlayingId(null);
      setPendingDelete(null);
      toast.success(t('deleteSuccess'));
    } catch {
      setDeleteError(t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-lg font-semibold text-foreground">
          {t('title')}
          {audio.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">{audio.length}</span>
          )}
        </h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading !== null}
        >
          {uploading
            ? t('uploading', { done: uploading.done, total: uploading.total })
            : t('add')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label={t('add')}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : audio.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {audio.map((item) => {
            const isPlaying = playingId === item.id;
            const label = item.recordedAt
              ? formatRecordedAt(item.recordedAt, dateFormat)
              : t('unknownDate');
            return (
              <li key={item.id} className="py-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPlayingId(isPlaying ? null : item.id)}
                    className="shrink-0 p-2 rounded-full border border-border text-foreground hover:bg-surface-elevated transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={isPlaying ? t('closePlayer', { name: item.originalName }) : t('play', { name: item.originalName })}
                    aria-expanded={isPlaying}
                    title={isPlaying ? t('closePlayer', { name: item.originalName }) : t('play', { name: item.originalName })}
                  >
                    {isPlaying ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z" />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-mono ${item.recordedAt ? 'text-foreground' : 'text-muted'}`}>{label}</p>
                    <p className="text-xs text-muted truncate" title={item.originalName}>
                      {item.originalName} · {formatSize(item.size)}
                    </p>
                  </div>
                  <a
                    href={audioUrl(personId, item.id, true)}
                    className="shrink-0 p-2 text-muted hover:text-foreground transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t('download', { name: item.originalName })}
                    title={t('download', { name: item.originalName })}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(item.id)}
                    className="shrink-0 p-2 text-muted hover:text-red-500 transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t('delete', { name: item.originalName })}
                    title={t('delete', { name: item.originalName })}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.87 12.14A2 2 0 0116.13 21H7.87a2 2 0 01-1.99-1.86L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                  </button>
                </div>
                {isPlaying && (
                  <audio
                    key={item.id}
                    src={audioUrl(personId, item.id)}
                    controls
                    autoPlay
                    preload="metadata"
                    className="mt-2 w-full dark:[color-scheme:dark]"
                    aria-label={label}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={confirmDelete}
        title={t('confirmDeleteTitle')}
        confirmText={t('confirmDelete')}
        cancelText={t('cancel')}
        isLoading={isDeleting}
        loadingText={t('deleting')}
        error={deleteError}
        variant="danger"
      >
        <p className="text-muted">{t('confirmDeleteDescription')}</p>
      </ConfirmationModal>
    </div>
  );
}
