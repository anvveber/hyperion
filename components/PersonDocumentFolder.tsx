'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from './ui/Button';
import ConfirmationModal from './ui/ConfirmationModal';
import { convertHeicToJpeg, isHeicFile } from '@/lib/photo-client';
import { documentKind, fileTypeLabel } from '@/lib/document-types';

interface PersonDocument {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  createdAt: string;
}

interface PersonDocumentFolderProps {
  personId: string;
}

// Keep in sync with MAX_PERSON_DOCUMENT_UPLOAD_SIZE in lib/person-document-storage.ts
const MAX_UPLOAD_MB = 200;

function documentUrl(personId: string, documentId: string, variant?: 'thumb' | 'download'): string {
  const base = `/api/people/${personId}/documents/${documentId}`;
  if (variant === 'thumb') return `${base}?size=thumb`;
  if (variant === 'download') return `${base}?download=1`;
  return base;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const iconClass = 'p-2 text-white/70 hover:text-white transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white';

function FileIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5" />
    </svg>
  );
}

function Preview({ personId, doc }: { personId: string; doc: PersonDocument }) {
  const t = useTranslations('people.documents');
  const [failed, setFailed] = useState(false);
  const url = documentUrl(personId, doc.id);
  const kind = failed ? 'other' : documentKind(doc.mimeType);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  switch (kind) {
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={doc.originalName}
          onClick={stop}
          onError={() => setFailed(true)}
          className="max-w-[85vw] max-h-[80vh] rounded-lg object-contain shadow-2xl"
        />
      );
    case 'pdf':
    case 'text':
      return (
        <iframe
          src={url}
          title={doc.originalName}
          onClick={stop}
          className="w-[90vw] max-w-5xl h-[80vh] rounded-lg bg-white shadow-2xl"
        />
      );
    case 'video':
      return (
        <video
          src={url}
          controls
          preload="metadata"
          onClick={stop}
          onError={() => setFailed(true)}
          className="max-w-[90vw] max-h-[80vh] rounded-lg bg-black shadow-2xl"
        />
      );
    case 'audio':
      return (
        <audio src={url} controls preload="metadata" onClick={stop} onError={() => setFailed(true)} className="w-[min(90vw,32rem)]" />
      );
    default:
      return (
        <div onClick={stop} className="flex flex-col items-center gap-4 rounded-lg bg-surface p-8 text-center shadow-2xl max-w-[90vw]">
          <FileIcon className="w-16 h-16 text-muted" />
          <p className="text-sm text-muted">{t('noPreview')}</p>
          <a
            href={documentUrl(personId, doc.id, 'download')}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-on-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {t('download')}
          </a>
        </div>
      );
  }
}

export default function PersonDocumentFolder({ personId }: PersonDocumentFolderProps) {
  const t = useTranslations('people.documents');
  const [documents, setDocuments] = useState<PersonDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}/documents`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { documents: PersonDocument[] }) => {
        if (!cancelled) setDocuments(data.documents);
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
    let added = 0;
    let duplicates = 0;
    let failed = 0;
    setUploading({ done: 0, total: files.length });

    // Upload one at a time so each request stays under the body size limit
    for (const [i, original] of files.entries()) {
      try {
        if (original.size > MAX_UPLOAD_MB * 1024 * 1024) {
          toast.error(t('tooLarge', { name: original.name, max: MAX_UPLOAD_MB }));
          failed += 1;
          continue;
        }
        let file: Blob = original;
        let name = original.name;
        // Browsers cannot show HEIC, so photos from iPhones are stored as JPEG
        if (isHeicFile(original)) {
          file = await convertHeicToJpeg(original);
          name = name.replace(/\.(heic|heif)$/i, '') + '.jpg';
        }
        const formData = new FormData();
        formData.append('file', file, name);
        const res = await fetch(`/api/people/${personId}/documents`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { document: PersonDocument; duplicate: boolean };
        if (data.duplicate) {
          duplicates += 1;
        } else {
          added += 1;
          setDocuments((prev) => [data.document, ...prev]);
        }
      } catch {
        failed += 1;
      } finally {
        setUploading({ done: i + 1, total: files.length });
      }
    }

    setUploading(null);
    if (inputRef.current) inputRef.current.value = '';
    if (added > 0) toast.success(t('uploadSuccess', { count: added }));
    if (duplicates > 0) toast.info(t('duplicate', { count: duplicates }));
    if (failed > 0) toast.error(t('uploadFailed', { count: failed }));
  };

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((idx) => {
        if (idx === null || documents.length === 0) return idx;
        return (idx + delta + documents.length) % documents.length;
      });
    },
    [documents.length]
  );

  useEffect(() => {
    if (openIndex === null || pendingDelete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [openIndex, pendingDelete, close, step]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/people/${personId}/documents/${pendingDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      const remaining = documents.filter((doc) => doc.id !== pendingDelete);
      setDocuments(remaining);
      setOpenIndex((idx) => {
        if (idx === null || remaining.length === 0) return null;
        return Math.min(idx, remaining.length - 1);
      });
      setPendingDelete(null);
      toast.success(t('deleteSuccess'));
    } catch {
      setDeleteError(t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const current = openIndex !== null ? documents[openIndex] : null;

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-lg font-semibold text-foreground">
          {t('title')}
          {documents.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">{documents.length}</span>
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
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label={t('add')}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {documents.map((doc, idx) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => setOpenIndex(idx)}
                className="block w-full aspect-square overflow-hidden rounded-md bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={t('view', { name: doc.originalName })}
                title={doc.originalName}
              >
                {doc.hasThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={documentUrl(personId, doc.id, 'thumb')}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-muted">
                    <span className="relative">
                      <FileIcon className="w-10 h-10" />
                      <span className="absolute inset-x-0 bottom-1.5 text-center text-[9px] font-semibold tracking-wide">
                        {fileTypeLabel(doc.originalName, doc.mimeType)}
                      </span>
                    </span>
                    <span className="w-full truncate text-center text-xs text-foreground">{doc.originalName}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && openIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={t('view', { name: current.originalName })}
        >
          <div
            className="absolute top-4 right-4 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={documentUrl(personId, current.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={iconClass}
              aria-label={t('openOriginal')}
              title={t('openOriginal')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
              </svg>
            </a>
            <a
              href={documentUrl(personId, current.id, 'download')}
              className={iconClass}
              aria-label={t('download')}
              title={t('download')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" />
              </svg>
            </a>
            <button
              type="button"
              onClick={() => setPendingDelete(current.id)}
              className="p-2 text-white/70 hover:text-red-400 transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={t('delete')}
              title={t('delete')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.87 12.14A2 2 0 0116.13 21H7.87a2 2 0 01-1.99-1.86L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={close}
              className={iconClass}
              aria-label={t('close')}
              title={t('close')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {documents.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); step(-1); }}
                className="absolute left-2 sm:left-4 p-3 text-white/70 hover:text-white transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={t('previous')}
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); step(1); }}
                className="absolute right-2 sm:right-4 p-3 text-white/70 hover:text-white transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={t('next')}
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          <Preview key={current.id} personId={personId} doc={current} />

          <p className="absolute bottom-4 inset-x-4 truncate text-center text-sm text-white/70">
            {current.originalName} · {formatSize(current.size)} · {t('position', { number: openIndex + 1, total: documents.length })}
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => { setPendingDelete(null); setDeleteError(null); }}
        onConfirm={confirmDelete}
        title={t('confirmDeleteTitle')}
        confirmText={t('delete')}
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
