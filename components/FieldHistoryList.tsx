'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatDate, type DateFormat } from '@/lib/date-format';
import { isHistoryField, type HistoryField } from '@/lib/field-history-fields';

export interface FieldHistoryEntry {
  id: string;
  field: HistoryField;
  type: string | null;
  value: string;
  platformId: string | null;
  /** ISO strings; only the date part is shown */
  validFrom: string | null;
  validTo: string | null;
}

const INPUT =
  'px-2 py-1 border border-border rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

interface EntryRowProps {
  personId: string;
  entry: FieldHistoryEntry;
  dateFormat: DateFormat;
}

function EntryRow({ personId, entry, dateFormat }: EntryRowProps) {
  const t = useTranslations('people.history');
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [value, setValue] = useState(entry.value);
  const [validFrom, setValidFrom] = useState(toDateInput(entry.validFrom));
  const [validTo, setValidTo] = useState(toDateInput(entry.validTo));

  const show = (date: string | null) => (date ? formatDate(date, dateFormat) : t('unknownDate'));

  const handleSave = async () => {
    if (!value.trim()) return;
    if (validFrom && validTo && validFrom > validTo) {
      toast.error(t('invalidRange'));
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch(`/api/people/${personId}/history/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value.trim(), validFrom: validFrom || null, validTo: validTo || null }),
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
      const response = await fetch(`/api/people/${personId}/history/${entry.id}`, { method: 'DELETE' });
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
      <li className="p-3 bg-surface-elevated rounded-lg space-y-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t('valuePlaceholder')}
          className={`w-full ${INPUT}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            {t('from')}
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={INPUT} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            {t('to')}
            <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={INPUT} />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isBusy || !value.trim()}
            className="px-3 py-1 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary-dark disabled:opacity-50"
          >
            {t('save')}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setValue(entry.value);
              setValidFrom(toDateInput(entry.validFrom));
              setValidTo(toDateInput(entry.validTo));
            }}
            className="px-3 py-1 text-sm border border-border text-foreground rounded-lg hover:bg-surface"
          >
            {t('cancel')}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-2 p-3 bg-surface-elevated rounded-lg">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {entry.type && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-badge-bg text-badge-text">
              {entry.type}
            </span>
          )}
          <span className="text-foreground line-through break-all">{entry.value}</span>
        </div>
        {entry.platformId && (
          <p className="text-xs text-muted font-mono mt-1">{t('platformId', { id: entry.platformId })}</p>
        )}
        <p className="text-xs text-muted font-mono mt-1">
          {t('period', { from: show(entry.validFrom), to: show(entry.validTo) })}
        </p>
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

interface FieldHistoryListProps {
  personId: string;
  field: HistoryField;
  entries: FieldHistoryEntry[];
  dateFormat: DateFormat;
}

/**
 * "View previous {field}" toggle with the kept values of one field.
 * Renders nothing when the field has no previous values.
 */
export default function FieldHistoryList({ personId, field, entries, dateFormat }: FieldHistoryListProps) {
  const t = useTranslations('people.history');
  const [isOpen, setIsOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="text-xs font-mono text-muted hover:text-foreground transition-colors"
      >
        {isOpen ? t('hide') : `${t(`view.${field}`)} (${entries.length})`}
      </button>
      {isOpen && (
        <ul className="mt-2 space-y-2">
          {entries.map((entry) => (
            <EntryRow key={entry.id} personId={personId} entry={entry} dateFormat={dateFormat} />
          ))}
        </ul>
      )}
    </div>
  );
}

const FIELD_ORDER: HistoryField[] = ['name', 'nickname', 'organization', 'jobTitle', 'phone', 'email', 'address', 'url', 'im'];

/** Small form to record a previous value by hand, e.g. an old address. */
export function AddFieldHistoryForm({ personId }: { personId: string }) {
  const t = useTranslations('people.history');
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [field, setField] = useState<HistoryField>('phone');
  const [type, setType] = useState('');
  const [value, setValue] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');

  const reset = () => {
    setType('');
    setValue('');
    setValidFrom('');
    setValidTo('');
  };

  const handleAdd = async () => {
    if (!value.trim()) return;
    if (validFrom && validTo && validFrom > validTo) {
      toast.error(t('invalidRange'));
      return;
    }
    setIsBusy(true);
    try {
      const response = await fetch(`/api/people/${personId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          type: type.trim() || null,
          value: value.trim(),
          validFrom: validFrom || null,
          validTo: validTo || null,
        }),
      });
      if (!response.ok) throw new Error('add failed');
      toast.success(t('added'));
      reset();
      setIsOpen(false);
      router.refresh();
    } catch {
      toast.error(t('error'));
    } finally {
      setIsBusy(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-sm text-primary hover:text-primary-dark"
      >
        + {t('addPrevious')}
      </button>
    );
  }

  return (
    <div className="p-3 border border-border rounded-lg space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={field}
          onChange={(e) => {
            if (isHistoryField(e.target.value)) setField(e.target.value);
          }}
          aria-label={t('fieldLabel')}
          className={INPUT}
        >
          {FIELD_ORDER.map((option) => (
            <option key={option} value={option}>
              {t(`fields.${option}`)}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder={t('typePlaceholder')}
          aria-label={t('typePlaceholder')}
          className={`w-40 ${INPUT}`}
        />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('valuePlaceholder')}
        aria-label={t('valuePlaceholder')}
        className={`w-full ${INPUT}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('from')}
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={INPUT} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('to')}
          <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={INPUT} />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={isBusy || !value.trim()}
          className="px-3 py-1 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary-dark disabled:opacity-50"
        >
          {t('add')}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setIsOpen(false);
          }}
          className="px-3 py-1 text-sm border border-border text-foreground rounded-lg hover:bg-surface"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
