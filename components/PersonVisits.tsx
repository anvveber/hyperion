'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatDate, type DateFormat } from '@/lib/date-format';

export interface PersonVisitEntry {
  id: string;
  /** ISO string; only the date part is shown */
  date: string | null;
  location: string;
  motivation: string | null;
}

const INPUT =
  'px-2 py-1 border border-border rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

interface VisitFormProps {
  initial?: PersonVisitEntry;
  submitLabel: string;
  isBusy: boolean;
  onSubmit: (values: { date: string | null; location: string; motivation: string | null }) => void;
  onCancel: () => void;
}

function VisitForm({ initial, submitLabel, isBusy, onSubmit, onCancel }: VisitFormProps) {
  const t = useTranslations('people.visits');
  const [date, setDate] = useState(toDateInput(initial?.date ?? null));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [motivation, setMotivation] = useState(initial?.motivation ?? '');

  const handleSubmit = () => {
    if (!location.trim()) return;
    onSubmit({ date: date || null, location: location.trim(), motivation: motivation.trim() || null });
  };

  return (
    <div className="p-3 border border-border rounded-lg space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t('locationPlaceholder')}
          aria-label={t('location')}
          maxLength={200}
          className={`flex-1 min-w-[12rem] ${INPUT}`}
        />
      </div>
      <textarea
        value={motivation}
        onChange={(e) => setMotivation(e.target.value)}
        placeholder={t('motivationPlaceholder')}
        aria-label={t('motivation')}
        maxLength={2000}
        rows={2}
        className={`w-full ${INPUT}`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isBusy || !location.trim()}
          className="px-3 py-1 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary-dark disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-sm border border-border text-foreground rounded-lg hover:bg-surface"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}

interface VisitRowProps {
  personId: string;
  visit: PersonVisitEntry;
  dateFormat: DateFormat;
}

function VisitRow({ personId, visit, dateFormat }: VisitRowProps) {
  const t = useTranslations('people.visits');
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const handleSave = async (values: { date: string | null; location: string; motivation: string | null }) => {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/people/${personId}/visits/${visit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('save failed');
      toast.success(t('saved'));
      setIsEditing(false);
      router.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('confirmDelete'))) return;
    setIsBusy(true);
    try {
      const response = await fetch(`/api/people/${personId}/visits/${visit.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      toast.success(t('deleted'));
      router.refresh();
    } catch {
      toast.error(t('error'));
      setIsBusy(false);
    }
  };

  if (isEditing) {
    return (
      <li>
        <VisitForm
          initial={visit}
          submitLabel={t('save')}
          isBusy={isBusy}
          onSubmit={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 p-3 bg-surface-elevated rounded-lg">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted font-mono">
          {visit.date ? formatDate(visit.date, dateFormat) : t('unknownDate')}
        </p>
        <p className="text-foreground font-medium break-words">{visit.location}</p>
        {visit.motivation && (
          <p className="text-sm text-muted mt-1 whitespace-pre-wrap break-words">{visit.motivation}</p>
        )}
      </div>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          disabled={isBusy}
          className="text-primary hover:text-primary-dark disabled:opacity-50"
        >
          {t('edit')}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isBusy}
          className="text-warning hover:underline disabled:opacity-50"
        >
          {t('delete')}
        </button>
      </div>
    </li>
  );
}

interface PersonVisitsProps {
  personId: string;
  visits: PersonVisitEntry[];
  dateFormat: DateFormat;
}

/** Location history: places a person went, with the date and the reason for going. */
export default function PersonVisits({ personId, visits, dateFormat }: PersonVisitsProps) {
  const t = useTranslations('people.visits');
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const handleAdd = async (values: { date: string | null; location: string; motivation: string | null }) => {
    setIsBusy(true);
    try {
      const response = await fetch(`/api/people/${personId}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('add failed');
      toast.success(t('added'));
      setIsAdding(false);
      router.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4">
      <h3 className="text-lg font-semibold text-foreground mb-1">{t('title')}</h3>
      <p className="text-sm text-muted mb-3">{t('description')}</p>
      {visits.length > 0 && (
        <ul className="space-y-2 mb-3">
          {visits.map((visit) => (
            <VisitRow key={visit.id} personId={personId} visit={visit} dateFormat={dateFormat} />
          ))}
        </ul>
      )}
      {isAdding ? (
        <VisitForm
          submitLabel={t('add')}
          isBusy={isBusy}
          onSubmit={handleAdd}
          onCancel={() => setIsAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="text-sm text-primary hover:text-primary-dark"
        >
          + {t('addVisit')}
        </button>
      )}
    </div>
  );
}
