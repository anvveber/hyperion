'use client';

import { useTranslations } from 'next-intl';
import type { CustomFieldTemplate } from '@prisma/client';
import type { CustomFieldValueInput } from '@/lib/customFields/persistence';
import { parseMultiSelectValue, serializeMultiSelectValue } from '@/lib/customFields/values';
import PersonAutocomplete from '@/components/PersonAutocomplete';

export type { CustomFieldValueInput };

/** A person that a PERSON field can link to. */
export interface LinkablePerson {
  id: string;
  name: string;
  surname?: string | null;
  nickname?: string | null;
  displayNameOverride?: string | null;
}

interface Props {
  templates: CustomFieldTemplate[];
  values: CustomFieldValueInput[];
  onChange: (values: CustomFieldValueInput[]) => void;
  /** People a PERSON field can link to (the person being edited excluded) */
  people?: LinkablePerson[];
  nameOrder?: 'WESTERN' | 'EASTERN';
}

export default function CustomFieldsSection({
  templates,
  values,
  onChange,
  people = [],
  nameOrder,
}: Props) {
  const t = useTranslations('customFields');

  if (templates.length === 0) return null;

  const valueByTemplate = new Map(values.map((v) => [v.templateId, v.value]));

  const setValue = (templateId: string, raw: string) => {
    const trimmed = raw.trim();
    const next = values.filter((v) => v.templateId !== templateId);
    if (trimmed.length > 0 && trimmed !== '[]') next.push({ templateId, value: raw });
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {templates.map((template) => {
        const current = valueByTemplate.get(template.id) ?? '';
        const inputId = `cf-value-${template.id}`;
        // Multi-select renders a checkbox group, labelled by a fieldset legend instead
        if (template.type === 'MULTI_SELECT') {
          return (
            <fieldset key={template.id}>
              <legend className="block text-sm font-medium text-foreground mb-1">
                {template.name}
              </legend>
              <MultiSelectInput
                template={template}
                current={current}
                set={(next) => setValue(template.id, next)}
                t={t}
              />
            </fieldset>
          );
        }
        return (
          <div key={template.id}>
            <label htmlFor={inputId} className="block text-sm font-medium text-foreground mb-1">
              {template.name}
            </label>
            {renderInput(
              template,
              inputId,
              current,
              (next) => setValue(template.id, next),
              t,
              people,
              nameOrder
            )}
          </div>
        );
      })}
    </div>
  );
}

function MultiSelectInput({
  template,
  current,
  set,
  t,
}: {
  template: CustomFieldTemplate;
  current: string;
  set: (next: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const selected = current ? parseMultiSelectValue(current) ?? [] : [];
  const stale = selected.filter((v) => !template.options.includes(v));
  const toggle = (option: string, checked: boolean) => {
    const next = checked ? [...selected, option] : selected.filter((v) => v !== option);
    set(next.length > 0 ? serializeMultiSelectValue(next, template.options) : '');
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {[...template.options, ...stale].map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={(e) => toggle(option, e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            {option}
          </label>
        ))}
      </div>
      {stale.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('person.valueOutOfOptions')}
        </p>
      )}
    </div>
  );
}

function renderInput(
  template: CustomFieldTemplate,
  inputId: string,
  current: string,
  set: (next: string) => void,
  t: ReturnType<typeof useTranslations>,
  people: LinkablePerson[],
  nameOrder?: 'WESTERN' | 'EASTERN'
) {
  const inputClass =
    'w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground';

  switch (template.type) {
    case 'TEXT':
      return (
        <input
          id={inputId}
          type="text"
          value={current}
          onChange={(e) => set(e.target.value)}
          className={inputClass}
          maxLength={2000}
        />
      );
    case 'NUMBER':
      return (
        <input
          id={inputId}
          type="number"
          step="any"
          value={current}
          onChange={(e) => set(e.target.value)}
          className={inputClass}
        />
      );
    case 'BOOLEAN':
      return (
        <select
          id={inputId}
          value={current}
          onChange={(e) => set(e.target.value)}
          className={inputClass}
        >
          <option value="">{t('person.booleanNotSet')}</option>
          <option value="true">{t('person.booleanYes')}</option>
          <option value="false">{t('person.booleanNo')}</option>
        </select>
      );
    case 'SELECT': {
      const isStaleValue =
        current.length > 0 && !template.options.includes(current);
      return (
        <div className="space-y-1">
          <select
            id={inputId}
            value={current}
            onChange={(e) => set(e.target.value)}
            className={inputClass}
          >
            <option value="">{t('person.selectEmpty')}</option>
            {isStaleValue && <option value={current}>{current}</option>}
            {template.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {isStaleValue && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('person.valueOutOfOptions')}
            </p>
          )}
        </div>
      );
    }
    case 'DATE':
      return (
        <input
          id={inputId}
          type="date"
          value={current}
          onChange={(e) => set(e.target.value)}
          className={inputClass}
        />
      );
    case 'URL':
      return (
        <input
          id={inputId}
          type="url"
          inputMode="url"
          value={current}
          onChange={(e) => set(e.target.value)}
          placeholder="https://"
          className={inputClass}
          maxLength={2000}
        />
      );
    case 'PERSON': {
      const isMissing = current.length > 0 && !people.some((p) => p.id === current);
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <PersonAutocomplete
                people={people}
                value={isMissing ? '' : current}
                onChange={(personId) => set(personId)}
                placeholder={t('person.personPlaceholder')}
                nameOrder={nameOrder}
                inputId={inputId}
              />
            </div>
            {current && (
              <button
                type="button"
                onClick={() => set('')}
                className="text-sm text-muted hover:text-foreground flex-shrink-0"
              >
                {t('person.clearPerson')}
              </button>
            )}
          </div>
          {isMissing && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('person.linkedPersonMissing')}
            </p>
          )}
        </div>
      );
    }
    case 'MULTI_SELECT':
      // Rendered by MultiSelectInput
      return null;
  }
}
