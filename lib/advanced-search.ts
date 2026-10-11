import { prisma } from '@/lib/prisma';
import { normalizeForSearch } from '@/lib/search';
import { getCountryName } from '@/lib/countries';

/**
 * Field-specific contact search used by the /search page.
 *
 * Every filter is optional. Filters that are set must all match (AND).
 * Matching is case- and accent-insensitive and accepts partial values,
 * so "mad" finds "Madrid" and "gmail" finds "ana@gmail.com".
 *
 * Names also match other names (nicknames, former names, other spellings).
 * With `previous` on, every filter also matches values kept in field history.
 */
export interface AdvancedSearchFilters {
  name: string;
  location: string;
  email: string;
  phone: string;
  handle: string;
  keywords: string;
  /** Also match previous values from field history */
  previous: boolean;
}

export const ADVANCED_SEARCH_FILTER_KEYS = ['name', 'location', 'email', 'phone', 'handle', 'keywords'] as const;

type TextFilterKey = (typeof ADVANCED_SEARCH_FILTER_KEYS)[number];

export const ADVANCED_SEARCH_MAX_RESULTS = 200;

export interface AdvancedSearchCandidate {
  id: string;
  name: string;
  surname: string | null;
  middleName: string | null;
  secondLastName: string | null;
  nickname: string | null;
  displayNameOverride: string | null;
  notes: string | null;
  photo: string | null;
  emails: { email: string }[];
  phoneNumbers: { number: string }[];
  addresses: {
    streetLine1: string | null;
    streetLine2: string | null;
    locality: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  }[];
  imHandles?: { protocol: string; handle: string; platformId: string | null }[];
  aliases?: { name: string }[];
  fieldHistory?: { field: string; value: string; data: unknown }[];
}

export interface AdvancedSearchResult {
  id: string;
  name: string;
  surname: string | null;
  middleName: string | null;
  secondLastName: string | null;
  nickname: string | null;
  displayNameOverride: string | null;
  photo: string | null;
  emails: string[];
  phones: string[];
  locations: string[];
  handles: string[];
  /** True when at least one filter only matched a previous value */
  matchedPrevious: boolean;
}

/** Read filters from URL search params, trimming whitespace. */
export function parseAdvancedSearchFilters(
  params: Record<string, string | string[] | undefined>
): AdvancedSearchFilters {
  const read = (key: string): string => {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    return (first ?? '').trim();
  };
  const previous = read('previous');
  return {
    name: read('name'),
    location: read('location'),
    email: read('email'),
    phone: read('phone'),
    handle: read('handle'),
    keywords: read('keywords'),
    previous: previous === '1' || previous === 'true' || previous === 'on',
  };
}

export function hasActiveFilters(filters: AdvancedSearchFilters): boolean {
  return ADVANCED_SEARCH_FILTER_KEYS.some((key: TextFilterKey) => filters[key].length > 0);
}

/** How a filter matched: not at all, on a current value, or only on a previous one. */
type MatchKind = 'none' | 'current' | 'previous';

function previousValues(person: AdvancedSearchCandidate, fields: string[]): string[] {
  return (person.fieldHistory ?? [])
    .filter((entry) => fields.includes(entry.field))
    .map((entry) => entry.value);
}

/** Platform ID kept in an IM history entry's data, if any. */
function historyPlatformId(data: unknown): string | null {
  if (data && typeof data === 'object' && 'platformId' in data) {
    const value = data.platformId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function combine(current: boolean, previous: () => boolean, allowPrevious: boolean): MatchKind {
  if (current) return 'current';
  if (allowPrevious && previous()) return 'previous';
  return 'none';
}

function includesNormalized(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return normalizeForSearch(haystack).includes(needle);
}

function matchesNameValue(value: string, q: string): boolean {
  return includesNormalized(value, q);
}

function matchesName(person: AdvancedSearchCandidate, query: string, allowPrevious: boolean): MatchKind {
  const q = normalizeForSearch(query);
  const fields = [
    person.name,
    person.middleName,
    person.surname,
    person.secondLastName,
    person.nickname,
    person.displayNameOverride,
  ];
  const current = () => {
    if (fields.some((field) => includesNormalized(field, q))) return true;
    if ((person.aliases ?? []).some((alias) => matchesNameValue(alias.name, q))) return true;
    // Queries spanning several name parts, e.g. "ana garcia"
    const joined = normalizeForSearch(fields.filter(Boolean).join(' '));
    return joined.includes(q);
  };
  return combine(
    current(),
    () => previousValues(person, ['name', 'nickname']).some((value) => matchesNameValue(value, q)),
    allowPrevious
  );
}

function matchesAddressParts(
  address: AdvancedSearchCandidate['addresses'][number],
  q: string
): boolean {
  const countryName = getCountryName(address.country);
  const parts = [
    address.streetLine1,
    address.streetLine2,
    address.locality,
    address.region,
    address.postalCode,
    countryName,
  ];
  if (parts.some((part) => includesNormalized(part, q))) return true;
  // Country codes only match exactly, so "us" does not hit every address in "Russia"
  if (address.country && normalizeForSearch(address.country) === q) return true;
  // Queries spanning several parts, e.g. "berlin germany"
  return normalizeForSearch(parts.filter(Boolean).join(' ')).includes(q);
}

function matchesLocation(person: AdvancedSearchCandidate, query: string, allowPrevious: boolean): MatchKind {
  const q = normalizeForSearch(query);
  return combine(
    person.addresses.some((address) => matchesAddressParts(address, q)),
    () => previousValues(person, ['address']).some((value) => includesNormalized(value, q)),
    allowPrevious
  );
}

function matchesEmail(person: AdvancedSearchCandidate, query: string, allowPrevious: boolean): MatchKind {
  const q = normalizeForSearch(query);
  return combine(
    person.emails.some((e) => includesNormalized(e.email, q)),
    () => previousValues(person, ['email']).some((value) => includesNormalized(value, q)),
    allowPrevious
  );
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function matchesPhoneNumber(number: string, query: string): boolean {
  const queryDigits = digitsOnly(query);
  // Ignore formatting so "612345" finds "+34 612 345 678"
  if (queryDigits.length > 0 && digitsOnly(number).includes(queryDigits)) return true;
  return includesNormalized(number, normalizeForSearch(query));
}

function matchesPhone(person: AdvancedSearchCandidate, query: string, allowPrevious: boolean): MatchKind {
  return combine(
    person.phoneNumbers.some((p) => matchesPhoneNumber(p.number, query)),
    () => previousValues(person, ['phone']).some((value) => matchesPhoneNumber(value, query)),
    allowPrevious
  );
}

/** Handles match by username or by platform ID (e.g. a Discord user ID). */
function matchesHandle(person: AdvancedSearchCandidate, query: string, allowPrevious: boolean): MatchKind {
  const q = normalizeForSearch(query.replace(/^@/, ''));
  const matchesId = (id: string | null) => id !== null && id.trim() !== '' && id.includes(query.trim());
  return combine(
    (person.imHandles ?? []).some((im) => includesNormalized(im.handle, q) || matchesId(im.platformId)),
    () =>
      (person.fieldHistory ?? [])
        .filter((entry) => entry.field === 'im')
        .some((entry) => includesNormalized(entry.value, q) || matchesId(historyPlatformId(entry.data))),
    allowPrevious
  );
}

function matchesKeywords(person: AdvancedSearchCandidate, query: string): boolean {
  if (!person.notes) return false;
  const notes = normalizeForSearch(person.notes);
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  return words.every((word) => notes.includes(word));
}

function formatAddress(address: AdvancedSearchCandidate['addresses'][number]): string {
  return [address.locality, address.region, getCountryName(address.country)]
    .filter(Boolean)
    .join(', ');
}

/** Pure filter step, separated from the database read so it can be unit tested. */
export function filterAdvancedSearch(
  people: AdvancedSearchCandidate[],
  filters: AdvancedSearchFilters
): AdvancedSearchResult[] {
  if (!hasActiveFilters(filters)) return [];

  const allowPrevious = filters.previous;
  const results: AdvancedSearchResult[] = [];

  for (const person of people) {
    const kinds: MatchKind[] = [];
    if (filters.name) kinds.push(matchesName(person, filters.name, allowPrevious));
    if (filters.location) kinds.push(matchesLocation(person, filters.location, allowPrevious));
    if (filters.email) kinds.push(matchesEmail(person, filters.email, allowPrevious));
    if (filters.phone) kinds.push(matchesPhone(person, filters.phone, allowPrevious));
    if (filters.handle) kinds.push(matchesHandle(person, filters.handle, allowPrevious));
    if (filters.keywords) kinds.push(matchesKeywords(person, filters.keywords) ? 'current' : 'none');
    if (kinds.includes('none')) continue;

    results.push({
      id: person.id,
      name: person.name,
      surname: person.surname,
      middleName: person.middleName,
      secondLastName: person.secondLastName,
      nickname: person.nickname,
      displayNameOverride: person.displayNameOverride,
      photo: person.photo,
      emails: person.emails.map((e) => e.email),
      phones: person.phoneNumbers.map((p) => p.number),
      locations: person.addresses.map(formatAddress).filter((loc) => loc.length > 0),
      handles: (person.imHandles ?? []).map((im) => `${im.protocol}: ${im.handle}`),
      matchedPrevious: kinds.includes('previous'),
    });
  }

  return results;
}

/**
 * Load the user's contacts and apply the filters in JS. Like /api/people/search,
 * this keeps matching accent-insensitive without PostgreSQL extensions.
 */
export async function advancedSearchPeople(
  userId: string,
  filters: AdvancedSearchFilters
): Promise<{ results: AdvancedSearchResult[]; total: number }> {
  if (!hasActiveFilters(filters)) return { results: [], total: 0 };

  const people = await prisma.person.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      surname: true,
      middleName: true,
      secondLastName: true,
      nickname: true,
      displayNameOverride: true,
      notes: true,
      photo: true,
      emails: { select: { email: true } },
      phoneNumbers: { select: { number: true } },
      addresses: {
        select: {
          streetLine1: true,
          streetLine2: true,
          locality: true,
          region: true,
          postalCode: true,
          country: true,
        },
      },
      imHandles: { select: { protocol: true, handle: true, platformId: true } },
      aliases: { select: { name: true } },
      fieldHistory: filters.previous
        ? { select: { field: true, value: true, data: true } }
        : false,
    },
    orderBy: [{ name: 'asc' }, { surname: 'asc' }],
  });

  const matches = filterAdvancedSearch(people, filters);
  return { results: matches.slice(0, ADVANCED_SEARCH_MAX_RESULTS), total: matches.length };
}
