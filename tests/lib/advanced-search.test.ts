import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { person: { findMany: mocks.personFindMany } },
}));

import {
  advancedSearchPeople,
  filterAdvancedSearch,
  hasActiveFilters,
  parseAdvancedSearchFilters,
  type AdvancedSearchCandidate,
  type AdvancedSearchFilters,
} from '@/lib/advanced-search';

const emptyFilters: AdvancedSearchFilters = {
  name: '',
  location: '',
  email: '',
  phone: '',
  handle: '',
  keywords: '',
  previous: false,
};

function person(overrides: Partial<AdvancedSearchCandidate>): AdvancedSearchCandidate {
  return {
    id: 'p',
    name: 'Someone',
    surname: null,
    middleName: null,
    secondLastName: null,
    nickname: null,
    displayNameOverride: null,
    notes: null,
    photo: null,
    emails: [],
    phoneNumbers: [],
    addresses: [],
    ...overrides,
  };
}

const maria = person({
  id: 'maria',
  name: 'María',
  surname: 'García',
  nickname: 'Majo',
  notes: 'Met at the climbing gym. Loves Japanese food.',
  emails: [{ email: 'Maria.Garcia@Example.com' }],
  phoneNumbers: [{ number: '+34 612 345 678' }],
  addresses: [{
    streetLine1: 'Calle Mayor 1',
    streetLine2: null,
    locality: 'Madrid',
    region: 'Comunidad de Madrid',
    postalCode: '28013',
    country: 'ES',
  }],
});

const john = person({
  id: 'john',
  name: 'John',
  surname: 'Smith',
  notes: 'Colleague from the Berlin office.',
  emails: [{ email: 'john@work.de' }, { email: 'jsmith@gmail.com' }],
  phoneNumbers: [{ number: '(030) 555-0101' }],
  addresses: [{
    streetLine1: null,
    streetLine2: null,
    locality: 'Berlin',
    region: null,
    postalCode: null,
    country: 'DE',
  }],
});

const russ = person({
  id: 'russ',
  name: 'Ivan',
  addresses: [{
    streetLine1: null,
    streetLine2: null,
    locality: 'Moscow',
    region: null,
    postalCode: null,
    country: 'RU',
  }],
});

const people = [maria, john, russ];

function ids(filters: Partial<AdvancedSearchFilters>): string[] {
  return filterAdvancedSearch(people, { ...emptyFilters, ...filters }).map((r) => r.id);
}

describe('advanced search', () => {
  describe('parseAdvancedSearchFilters', () => {
    it('trims values and fills missing keys', () => {
      expect(parseAdvancedSearchFilters({ name: '  ana ', phone: ['123', '456'] })).toEqual({
        ...emptyFilters,
        name: 'ana',
        phone: '123',
      });
    });
  });

  describe('hasActiveFilters', () => {
    it('is false when every filter is empty', () => {
      expect(hasActiveFilters(emptyFilters)).toBe(false);
      expect(hasActiveFilters({ ...emptyFilters, email: 'x' })).toBe(true);
    });
  });

  describe('filterAdvancedSearch', () => {
    it('returns nothing when no filter is set', () => {
      expect(ids({})).toEqual([]);
    });

    it('matches names partially, ignoring case and accents', () => {
      expect(ids({ name: 'mari' })).toEqual(['maria']);
      expect(ids({ name: 'GARCIA' })).toEqual(['maria']);
      expect(ids({ name: 'majo' })).toEqual(['maria']);
      expect(ids({ name: 'maria garcia' })).toEqual(['maria']);
    });

    it('matches location by city, region, postal code, and country name or code', () => {
      expect(ids({ location: 'madr' })).toEqual(['maria']);
      expect(ids({ location: '28013' })).toEqual(['maria']);
      expect(ids({ location: 'germany' })).toEqual(['john']);
      expect(ids({ location: 'berlin germany' })).toEqual(['john']);
    });

    it('matches country codes exactly', () => {
      expect(ids({ location: 'ru' })).toEqual(['russ']);
      expect(ids({ location: 'ES' })).toEqual(['maria']);
    });

    it('matches email partially and case-insensitively', () => {
      expect(ids({ email: 'example.com' })).toEqual(['maria']);
      expect(ids({ email: 'GMAIL' })).toEqual(['john']);
    });

    it('matches phone numbers ignoring formatting', () => {
      expect(ids({ phone: '612345' })).toEqual(['maria']);
      expect(ids({ phone: '612 345 678' })).toEqual(['maria']);
      expect(ids({ phone: '030-555' })).toEqual(['john']);
      expect(ids({ phone: '999' })).toEqual([]);
    });

    it('requires every keyword to appear in notes, in any order', () => {
      expect(ids({ keywords: 'japanese climbing' })).toEqual(['maria']);
      expect(ids({ keywords: 'berlin' })).toEqual(['john']);
      expect(ids({ keywords: 'japanese berlin' })).toEqual([]);
    });

    it('combines filters with AND', () => {
      expect(ids({ name: 'john', location: 'berlin' })).toEqual(['john']);
      expect(ids({ name: 'john', location: 'madrid' })).toEqual([]);
    });

    it('returns contact details for display', () => {
      const [result] = filterAdvancedSearch([maria], { ...emptyFilters, name: 'maria' });
      expect(result.emails).toEqual(['Maria.Garcia@Example.com']);
      expect(result.phones).toEqual(['+34 612 345 678']);
      expect(result.locations).toEqual(['Madrid, Comunidad de Madrid, Spain']);
    });
  });

  describe('other names, handles and previous values', () => {
    const lena = person({
      id: 'lena',
      name: 'Lena',
      surname: 'Ivanova',
      aliases: [{ name: 'Лена Иванова' }, { name: 'Lena Petrova' }],
      imHandles: [{ protocol: 'discord', handle: 'lenaplays', platformId: '123456789012345678' }],
      fieldHistory: [
        { field: 'phone', value: '+49 170 1112223', data: null },
        { field: 'address', value: 'Hauptstr. 5, Hamburg, Germany', data: null },
        { field: 'im', value: 'lena_old', data: { platformId: '123456789012345678' } },
        { field: 'name', value: 'Lena Smirnova', data: null },
      ],
    });

    function find(filters: Partial<AdvancedSearchFilters>) {
      return filterAdvancedSearch([lena, maria], { ...emptyFilters, ...filters });
    }

    it('matches other names, including other alphabets', () => {
      expect(find({ name: 'иванова' }).map((r) => r.id)).toEqual(['lena']);
      expect(find({ name: 'petrova' }).map((r) => r.id)).toEqual(['lena']);
    });

    it('matches handles by username or platform ID', () => {
      expect(find({ handle: '@lenaplays' }).map((r) => r.id)).toEqual(['lena']);
      expect(find({ handle: '123456789012345678' }).map((r) => r.id)).toEqual(['lena']);
    });

    it('ignores previous values unless asked', () => {
      expect(find({ phone: '1701112223' })).toEqual([]);
      expect(find({ location: 'hamburg' })).toEqual([]);
      expect(find({ name: 'smirnova' })).toEqual([]);
    });

    it('matches previous values when asked and flags them', () => {
      const [byPhone] = find({ phone: '1701112223', previous: true });
      expect(byPhone.id).toBe('lena');
      expect(byPhone.matchedPrevious).toBe(true);
      expect(find({ location: 'hamburg', previous: true }).map((r) => r.id)).toEqual(['lena']);
      expect(find({ name: 'smirnova', previous: true }).map((r) => r.id)).toEqual(['lena']);
      expect(find({ handle: 'lena_old', previous: true }).map((r) => r.id)).toEqual(['lena']);
    });

    it('does not flag a current match as previous', () => {
      const [result] = find({ name: 'lena', previous: true });
      expect(result.matchedPrevious).toBe(false);
      expect(result.handles).toEqual(['discord: lenaplays']);
    });

    it('reads the previous flag from the URL', () => {
      expect(parseAdvancedSearchFilters({ previous: '1' }).previous).toBe(true);
      expect(parseAdvancedSearchFilters({}).previous).toBe(false);
    });
  });

  describe('advancedSearchPeople', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('does not query the database without filters', async () => {
      const result = await advancedSearchPeople('user1', emptyFilters);
      expect(result).toEqual({ results: [], total: 0 });
      expect(mocks.personFindMany).not.toHaveBeenCalled();
    });

    it("only reads the user's non-deleted people", async () => {
      mocks.personFindMany.mockResolvedValue(people);
      const result = await advancedSearchPeople('user1', { ...emptyFilters, location: 'berlin' });
      expect(mocks.personFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user1', deletedAt: null } })
      );
      expect(result.total).toBe(1);
      expect(result.results[0].id).toBe('john');
    });
  });
});
