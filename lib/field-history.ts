/**
 * Field history: when a tracked field changes, the old value is kept as a
 * PersonFieldHistory row with valid-from and valid-to dates instead of being
 * overwritten.
 *
 * Multi-value fields (phones, emails, addresses, URLs, IM handles) are stored
 * with a delete-and-recreate pattern. To keep a meaningful "valid from" date,
 * rows whose value did not change keep their original createdAt, and that
 * createdAt becomes validFrom once the value is replaced or removed.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCountryName } from '@/lib/countries';

export { HISTORY_FIELDS, isHistoryField, type HistoryField } from '@/lib/field-history-fields';

const SCALAR_HISTORY_FIELDS = ['name', 'nickname', 'organization', 'jobTitle'] as const;
type ScalarHistoryField = (typeof SCALAR_HISTORY_FIELDS)[number];

function isScalarHistoryField(value: string): value is ScalarHistoryField {
  return (SCALAR_HISTORY_FIELDS as readonly string[]).includes(value);
}

// ─── Value shapes ────────────────────────────────────────────────────────────

export interface PhoneValue {
  type: string;
  number: string;
}

export interface EmailValue {
  type: string;
  email: string;
}

export interface AddressValue {
  type: string;
  streetLine1: string | null;
  streetLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface UrlValue {
  type: string;
  url: string;
}

export interface ImValue {
  protocol: string;
  handle: string;
  /** undefined means "not provided": keep the stored ID for the same handle */
  platformId?: string | null;
}

type Stored<T> = T & { createdAt: Date };

/** The current state of every tracked field, as stored. */
export interface TrackedState {
  name: string;
  middleName: string | null;
  surname: string | null;
  secondLastName: string | null;
  nickname: string | null;
  organization: string | null;
  jobTitle: string | null;
  phoneNumbers: Stored<PhoneValue>[];
  emails: Stored<EmailValue>[];
  addresses: Stored<AddressValue>[];
  urls: Stored<UrlValue>[];
  imHandles: Stored<ImValue & { platformId: string | null }>[];
}

/** Incoming values. A field left undefined is not being changed. */
export interface TrackedInput {
  name?: string;
  middleName?: string | null;
  surname?: string | null;
  secondLastName?: string | null;
  nickname?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  phoneNumbers?: PhoneValue[];
  emails?: EmailValue[];
  addresses?: AddressValue[];
  urls?: UrlValue[];
  imHandles?: ImValue[];
}

export type HistoryEntryInput = Prisma.PersonFieldHistoryCreateWithoutPersonInput;

/** Rows to create, with createdAt carried over for unchanged values. */
export interface TrackedUpdatePlan {
  history: HistoryEntryInput[];
  phoneNumbers?: Array<PhoneValue & { createdAt?: Date }>;
  emails?: Array<EmailValue & { createdAt?: Date }>;
  addresses?: Array<AddressValue & { createdAt?: Date }>;
  urls?: Array<UrlValue & { createdAt?: Date }>;
  imHandles?: Array<{ protocol: string; handle: string; platformId: string | null; createdAt?: Date }>;
}

// ─── Keys and display values ─────────────────────────────────────────────────

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function phoneKey(number: string): string {
  const compact = number.replace(/[^\d+]/g, '');
  return compact || norm(number);
}

export function addressKey(a: Omit<AddressValue, 'type'>): string {
  return [a.streetLine1, a.streetLine2, a.locality, a.region, a.postalCode, a.country]
    .map(norm)
    .join('|');
}

export function imKey(im: { protocol: string; handle: string }): string {
  return `${norm(im.protocol)}:${norm(im.handle)}`;
}

export function formatAddressValue(a: Omit<AddressValue, 'type'>): string {
  return [
    a.streetLine1,
    a.streetLine2,
    a.locality,
    a.region,
    a.postalCode,
    getCountryName(a.country) || a.country,
  ]
    .filter(Boolean)
    .join(', ');
}

export function formatNameValue(parts: {
  name: string;
  middleName: string | null;
  surname: string | null;
  secondLastName: string | null;
}): string {
  return [parts.name, parts.middleName, parts.surname, parts.secondLastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

// ─── Planning ────────────────────────────────────────────────────────────────

function firstByKey<T>(rows: T[], keyOf: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

/**
 * Compare stored rows with the incoming list. Returns the rows to create
 * (carrying createdAt for kept values) and a history entry for each stored
 * value that is no longer present.
 */
function planList<S extends { createdAt: Date }, I>(
  stored: S[],
  incoming: I[],
  keyOfStored: (row: S) => string,
  keyOfIncoming: (row: I) => string,
  toHistory: (row: S) => Omit<HistoryEntryInput, 'validFrom' | 'validTo'>,
  now: Date,
): { kept: Map<string, S>; history: HistoryEntryInput[] } {
  const storedByKey = firstByKey(stored, keyOfStored);
  const incomingKeys = new Set(incoming.map(keyOfIncoming));
  const history: HistoryEntryInput[] = [];
  const seen = new Set<string>();
  for (const row of stored) {
    const key = keyOfStored(row);
    if (incomingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    history.push({ ...toHistory(row), validFrom: row.createdAt, validTo: now });
  }
  return { kept: storedByKey, history };
}

/**
 * Pure planning step: decide which history entries to write and which
 * createdAt values to carry over. `scalarSince` holds, per scalar field, the
 * validTo of the most recent history entry, which is when the current value
 * started (when known).
 */
export function planTrackedUpdate(
  before: TrackedState,
  input: TrackedInput,
  now: Date,
  scalarSince: Partial<Record<ScalarHistoryField, Date>> = {},
): TrackedUpdatePlan {
  const plan: TrackedUpdatePlan = { history: [] };

  // Name: compare the combined full name so a change to any part is recorded once
  const nameTouched =
    input.name !== undefined ||
    input.middleName !== undefined ||
    input.surname !== undefined ||
    input.secondLastName !== undefined;
  if (nameTouched) {
    const oldName = formatNameValue(before);
    const newName = formatNameValue({
      name: input.name ?? before.name,
      middleName: input.middleName !== undefined ? input.middleName : before.middleName,
      surname: input.surname !== undefined ? input.surname : before.surname,
      secondLastName: input.secondLastName !== undefined ? input.secondLastName : before.secondLastName,
    });
    if (oldName && oldName !== newName) {
      plan.history.push({
        field: 'name',
        value: oldName,
        data: {
          name: before.name,
          middleName: before.middleName,
          surname: before.surname,
          secondLastName: before.secondLastName,
        },
        validFrom: scalarSince.name ?? null,
        validTo: now,
      });
    }
  }

  for (const field of ['nickname', 'organization', 'jobTitle'] as const) {
    const next = input[field];
    if (next === undefined) continue;
    const previous = before[field];
    if (previous && previous.trim() !== (next ?? '').trim()) {
      plan.history.push({
        field,
        value: previous,
        validFrom: scalarSince[field] ?? null,
        validTo: now,
      });
    }
  }

  if (input.phoneNumbers !== undefined) {
    const { kept, history } = planList(
      before.phoneNumbers,
      input.phoneNumbers,
      (p) => phoneKey(p.number),
      (p) => phoneKey(p.number),
      (p) => ({ field: 'phone', type: p.type, value: p.number }),
      now,
    );
    plan.history.push(...history);
    plan.phoneNumbers = input.phoneNumbers.map((p) => ({
      type: p.type,
      number: p.number,
      createdAt: kept.get(phoneKey(p.number))?.createdAt,
    }));
  }

  if (input.emails !== undefined) {
    const { kept, history } = planList(
      before.emails,
      input.emails,
      (e) => norm(e.email),
      (e) => norm(e.email),
      (e) => ({ field: 'email', type: e.type, value: e.email }),
      now,
    );
    plan.history.push(...history);
    plan.emails = input.emails.map((e) => ({
      type: e.type,
      email: e.email,
      createdAt: kept.get(norm(e.email))?.createdAt,
    }));
  }

  if (input.addresses !== undefined) {
    const { kept, history } = planList(
      before.addresses,
      input.addresses,
      addressKey,
      addressKey,
      (a) => ({
        field: 'address',
        type: a.type,
        value: formatAddressValue(a),
        data: {
          streetLine1: a.streetLine1,
          streetLine2: a.streetLine2,
          locality: a.locality,
          region: a.region,
          postalCode: a.postalCode,
          country: a.country,
        },
      }),
      now,
    );
    plan.history.push(...history);
    plan.addresses = input.addresses.map((a) => ({
      ...a,
      createdAt: kept.get(addressKey(a))?.createdAt,
    }));
  }

  if (input.urls !== undefined) {
    const { kept, history } = planList(
      before.urls,
      input.urls,
      (u) => norm(u.url),
      (u) => norm(u.url),
      (u) => ({ field: 'url', type: u.type, value: u.url }),
      now,
    );
    plan.history.push(...history);
    plan.urls = input.urls.map((u) => ({
      type: u.type,
      url: u.url,
      createdAt: kept.get(norm(u.url))?.createdAt,
    }));
  }

  if (input.imHandles !== undefined) {
    const { kept, history } = planList(
      before.imHandles,
      input.imHandles,
      imKey,
      imKey,
      (im) => ({
        field: 'im',
        type: im.protocol,
        value: im.handle,
        data: im.platformId ? { platformId: im.platformId } : undefined,
      }),
      now,
    );
    plan.history.push(...history);
    plan.imHandles = input.imHandles.map((im) => {
      const match = kept.get(imKey(im));
      const platformId =
        im.platformId !== undefined ? im.platformId?.trim() || null : match?.platformId ?? null;
      return {
        protocol: im.protocol,
        handle: im.handle,
        platformId,
        createdAt: match?.createdAt,
      };
    });
  }

  return plan;
}

// ─── Database helpers ────────────────────────────────────────────────────────

/** Prisma include for the multi-value relations a TrackedState needs. */
export const trackedRelationsInclude = {
  phoneNumbers: { select: { type: true, number: true, createdAt: true } },
  emails: { select: { type: true, email: true, createdAt: true } },
  addresses: {
    select: {
      type: true,
      streetLine1: true,
      streetLine2: true,
      locality: true,
      region: true,
      postalCode: true,
      country: true,
      createdAt: true,
    },
  },
  urls: { select: { type: true, url: true, createdAt: true } },
  imHandles: { select: { protocol: true, handle: true, platformId: true, createdAt: true } },
} satisfies Prisma.PersonInclude;

/** Prisma select that loads a person's TrackedState. */
export const trackedStateSelect = {
  name: true,
  middleName: true,
  surname: true,
  secondLastName: true,
  nickname: true,
  organization: true,
  jobTitle: true,
  ...trackedRelationsInclude,
} satisfies Prisma.PersonSelect;

type HistoryClient = Pick<typeof prisma, 'person' | 'personFieldHistory'>;

/** True when the plan keeps an old scalar value, so its "valid from" is worth looking up. */
export function keepsScalarHistory(plan: TrackedUpdatePlan): boolean {
  return plan.history.some((entry) => isScalarHistoryField(entry.field));
}

/**
 * For each scalar field, the validTo of its most recent history entry: the
 * day the current value started, when known.
 */
export async function loadScalarSince(
  client: Pick<typeof prisma, 'personFieldHistory'>,
  personId: string,
): Promise<Partial<Record<ScalarHistoryField, Date>>> {
  const previous = await client.personFieldHistory.findMany({
    where: { personId, field: { in: [...SCALAR_HISTORY_FIELDS] }, validTo: { not: null } },
    select: { field: true, validTo: true },
    orderBy: { validTo: 'desc' },
  });
  const scalarSince: Partial<Record<ScalarHistoryField, Date>> = {};
  for (const row of previous) {
    if (!isScalarHistoryField(row.field)) continue;
    if (row.validTo && !scalarSince[row.field]) scalarSince[row.field] = row.validTo;
  }
  return scalarSince;
}

/**
 * Load the stored state of a person and plan the update. Returns null when
 * the person does not exist.
 */
export async function loadTrackedUpdatePlan(
  client: HistoryClient,
  personId: string,
  input: TrackedInput,
  now: Date = new Date(),
): Promise<TrackedUpdatePlan | null> {
  const before = await client.person.findUnique({
    where: { id: personId },
    select: trackedStateSelect,
  });
  if (!before) return null;

  const plan = planTrackedUpdate(before, input, now);
  return keepsScalarHistory(plan)
    ? planTrackedUpdate(before, input, now, await loadScalarSince(client, personId))
    : plan;
}
