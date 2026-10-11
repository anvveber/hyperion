import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { planTrackedUpdate, type TrackedState } from '@/lib/field-history';

const since = new Date('2024-01-15T10:00:00Z');
const now = new Date('2026-10-11T08:00:00Z');

function state(overrides: Partial<TrackedState> = {}): TrackedState {
  return {
    name: 'Lena',
    middleName: null,
    surname: 'Ivanova',
    secondLastName: null,
    nickname: null,
    organization: 'Acme',
    jobTitle: null,
    phoneNumbers: [{ type: 'Mobile', number: '+49 170 1112223', createdAt: since }],
    emails: [{ type: 'Personal', email: 'lena@example.com', createdAt: since }],
    addresses: [{
      type: 'Home',
      streetLine1: 'Hauptstr. 5',
      streetLine2: null,
      locality: 'Hamburg',
      region: null,
      postalCode: '20095',
      country: 'DE',
      createdAt: since,
    }],
    urls: [],
    imHandles: [{ protocol: 'discord', handle: 'lena_old', platformId: '123456789012345678', createdAt: since }],
    ...overrides,
  };
}

describe('planTrackedUpdate', () => {
  it('writes nothing when no tracked field is part of the update', () => {
    expect(planTrackedUpdate(state(), {}, now)).toEqual({ history: [] });
  });

  it('keeps a replaced phone number with its dates', () => {
    const plan = planTrackedUpdate(state(), {
      phoneNumbers: [{ type: 'Mobile', number: '+49 170 9998887' }],
    }, now);
    expect(plan.history).toEqual([
      { field: 'phone', type: 'Mobile', value: '+49 170 1112223', validFrom: since, validTo: now },
    ]);
    expect(plan.phoneNumbers).toEqual([{ type: 'Mobile', number: '+49 170 9998887', createdAt: undefined }]);
  });

  it('treats a reformatted number or a new label as the same value', () => {
    const plan = planTrackedUpdate(state(), {
      phoneNumbers: [{ type: 'Work', number: '+491701112223' }],
    }, now);
    expect(plan.history).toEqual([]);
    expect(plan.phoneNumbers?.[0].createdAt).toBe(since);
  });

  it('keeps removed emails and addresses', () => {
    const plan = planTrackedUpdate(state(), { emails: [], addresses: [] }, now);
    expect(plan.history.map((h) => h.field)).toEqual(['email', 'address']);
    const address = plan.history[1];
    expect(address.value).toBe('Hauptstr. 5, Hamburg, 20095, Germany');
    expect(address.data).toMatchObject({ locality: 'Hamburg', country: 'DE' });
  });

  it('keeps an old username and moves the platform ID to the new one when sent', () => {
    const plan = planTrackedUpdate(state(), {
      imHandles: [{ protocol: 'discord', handle: 'lena_new', platformId: '123456789012345678' }],
    }, now);
    expect(plan.history).toEqual([
      {
        field: 'im',
        type: 'discord',
        value: 'lena_old',
        data: { platformId: '123456789012345678' },
        validFrom: since,
        validTo: now,
      },
    ]);
    expect(plan.imHandles).toEqual([
      { protocol: 'discord', handle: 'lena_new', platformId: '123456789012345678', createdAt: undefined },
    ]);
  });

  it('keeps the stored platform ID when the update does not mention it', () => {
    const plan = planTrackedUpdate(state(), {
      imHandles: [{ protocol: 'Discord', handle: 'LENA_OLD' }],
    }, now);
    expect(plan.history).toEqual([]);
    expect(plan.imHandles?.[0]).toMatchObject({ platformId: '123456789012345678', createdAt: since });
  });

  it('clears the platform ID when sent empty', () => {
    const plan = planTrackedUpdate(state(), {
      imHandles: [{ protocol: 'discord', handle: 'lena_old', platformId: '' }],
    }, now);
    expect(plan.imHandles?.[0].platformId).toBeNull();
  });

  it('records a name change once, with the full previous name', () => {
    const plan = planTrackedUpdate(state(), { name: 'Lena', surname: 'Petrova' }, now, {
      name: new Date('2020-05-01T00:00:00Z'),
    });
    expect(plan.history).toEqual([
      expect.objectContaining({
        field: 'name',
        value: 'Lena Ivanova',
        validFrom: new Date('2020-05-01T00:00:00Z'),
        validTo: now,
      }),
    ]);
  });

  it('records scalar changes but not newly filled or unchanged values', () => {
    const plan = planTrackedUpdate(state(), {
      organization: 'Globex',
      jobTitle: 'Engineer',
      nickname: null,
      surname: 'Ivanova',
    }, now);
    expect(plan.history).toEqual([
      { field: 'organization', value: 'Acme', validFrom: null, validTo: now },
    ]);
  });
});
