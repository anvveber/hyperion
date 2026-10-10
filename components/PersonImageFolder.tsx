'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from './ui/Button';
import ConfirmationModal from './ui/ConfirmationModal';
import { convertHeicToJpeg, isHeicFile } from '@/lib/photo-client';

interface PersonImage {
  id: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

interface PersonImageFolderProps {
  personId: string;
}

function imageUrl(personId: string, imageId: string, thumb = false): string {
  return `/api/people/${personId}/images/${imageId}${thumb ? '?size=thumb' : ''}`;
}

export default function PersonImageFolder({ personId }: PersonImageFolderProps) {
  const t = useTranslations('people.images');
  const [images, setImages] = useState<PersonImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}/images`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { images: PersonImage[] }) => {
        if (!cancelled) setImages(data.images);
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
    for (const [i, original] of files.entries()) {
      try {
        let file: Blob = original;
        if (isHeicFile(original)) {
          file = await convertHeicToJpeg(original);
        }
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`/api/people/${personId}/images`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { image: PersonImage };
        setImages((prev) => [data.image, ...prev]);
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

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((idx) => {
        if (idx === null || images.length === 0) return idx;
        return (idx + delta + images.length) % images.length;
      });
    },
    [images.length]
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
      const res = await fetch(`/api/people/${personId}/images/${pendingDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      const remaining = images.filter((img) => img.id !== pendingDelete);
      setImages(remaining);
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

  const current = openIndex !== null ? images[openIndex] : null;

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3 className="text-lg font-semibold text-foreground">
          {t('title')}
          {images.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">{images.length}</span>
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
          accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          aria-label={t('add')}
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : images.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {images.map((img, idx) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setOpenIndex(idx)}
                className="block w-full aspect-square overflow-hidden rounded-md bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={t('view', { number: idx + 1 })}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(personId, img.id, true)}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
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
          aria-label={t('view', { number: openIndex + 1 })}
        >
          <div
            className="absolute top-4 right-4 flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={imageUrl(personId, current.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-white/70 hover:text-white transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={t('openOriginal')}
              title={t('openOriginal')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
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
              className="p-2 text-white/70 hover:text-white transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={t('close')}
              title={t('close')}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {images.length > 1 && (
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

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={current.id}
            src={imageUrl(personId, current.id)}
            alt={t('view', { number: openIndex + 1 })}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[85vw] max-h-[85vh] rounded-lg object-contain shadow-2xl"
          />

          <p className="absolute bottom-4 text-sm text-white/70">
            {t('position', { number: openIndex + 1, total: images.length })}
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
