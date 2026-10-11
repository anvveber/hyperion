import type { CustomFieldType } from '@prisma/client';

export type ValidationErrorCode =
  | 'NOT_A_NUMBER'
  | 'NOT_BOOLEAN'
  | 'NOT_IN_OPTIONS'
  | 'NOT_A_DATE'
  | 'NOT_A_URL'
  | 'NOT_A_LIST'
  | 'NOT_A_PERSON';

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: ValidationErrorCode };

/** Field types whose values are picked from the template's options. */
export const OPTION_FIELD_TYPES: readonly CustomFieldType[] = ['SELECT', 'MULTI_SELECT'];

export function usesOptions(type: CustomFieldType): boolean {
  return OPTION_FIELD_TYPES.includes(type);
}

export function isEmptyRawValue(raw: string): boolean {
  if (raw.trim() === '') return true;
  // An empty multi-select list counts as "no value"
  return raw.trim() === '[]';
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** True for an absolute http(s) URL. */
export function isWebUrl(raw: string): boolean {
  if (/\s/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Multi-select values are stored as a JSON array of option strings,
 * e.g. '["Vegan","Gluten free"]'. Returns null when the raw value is not
 * a JSON array of strings.
 */
export function parseMultiSelectValue(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

/** Serialize selected options, dropping duplicates and keeping the template's option order. */
export function serializeMultiSelectValue(selected: string[], options: string[]): string {
  const chosen = new Set(selected);
  const ordered = options.filter((o) => chosen.has(o));
  // Keep values that are no longer options (renamed or removed) at the end
  const extra = Array.from(chosen).filter((v) => !options.includes(v));
  return JSON.stringify([...ordered, ...extra]);
}

/**
 * Check a raw value against its field type. PERSON values only get a shape
 * check here; that the linked person exists and belongs to the user is
 * checked against the database in persistence.ts.
 */
export function validateRawValue(
  type: CustomFieldType,
  raw: string,
  options: string[]
): ValidationResult {
  switch (type) {
    case 'TEXT':
      return { ok: true };
    case 'NUMBER': {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: 'NOT_A_NUMBER' };
      }
      return { ok: true };
    }
    case 'BOOLEAN':
      if (raw === 'true' || raw === 'false') return { ok: true };
      return { ok: false, error: 'NOT_BOOLEAN' };
    case 'SELECT':
      if (options.includes(raw)) return { ok: true };
      return { ok: false, error: 'NOT_IN_OPTIONS' };
    case 'DATE':
      if (isIsoDate(raw)) return { ok: true };
      return { ok: false, error: 'NOT_A_DATE' };
    case 'URL':
      if (isWebUrl(raw)) return { ok: true };
      return { ok: false, error: 'NOT_A_URL' };
    case 'MULTI_SELECT': {
      const selected = parseMultiSelectValue(raw);
      if (!selected || selected.length === 0 || new Set(selected).size !== selected.length) {
        return { ok: false, error: 'NOT_A_LIST' };
      }
      if (selected.every((v) => options.includes(v))) return { ok: true };
      return { ok: false, error: 'NOT_IN_OPTIONS' };
    }
    case 'PERSON':
      if (/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return { ok: true };
      return { ok: false, error: 'NOT_A_PERSON' };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Plain-text form of a stored value for search and export to other tools.
 * PERSON values need the linked person's name, so callers pass a lookup.
 */
export function customFieldValueToText(
  type: CustomFieldType,
  raw: string,
  personName?: (id: string) => string | null
): string {
  if (type === 'MULTI_SELECT') {
    return (parseMultiSelectValue(raw) ?? []).join(', ');
  }
  if (type === 'PERSON') {
    return personName?.(raw) ?? '';
  }
  return raw;
}
