/**
 * Fields whose previous values are kept in PersonFieldHistory.
 * Kept free of server imports so client components and validation can use it.
 */
export const HISTORY_FIELDS = [
  'name',
  'nickname',
  'organization',
  'jobTitle',
  'phone',
  'email',
  'address',
  'url',
  'im',
] as const;

export type HistoryField = (typeof HISTORY_FIELDS)[number];

export function isHistoryField(value: string): value is HistoryField {
  return (HISTORY_FIELDS as readonly string[]).includes(value);
}
