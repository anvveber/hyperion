import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    person: {
      findUnique: mocks.personFindUnique,
    },
  },
}));

vi.mock('../../lib/auth', () => ({
  auth: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-123', email: 'test@example.com', name: 'Test' },
    })
  ),
}));

import { GET } from '../../app/api/people/[id]/export/route';

function entry(id: string, date: string) {
  return {
    journalEntry: {
      id,
      title: `Entry ${id}`,
      date: new Date(date),
      body: 'Met for coffee',
      people: [
        { person: { id: 'person-1', name: 'Ada', surname: 'Lovelace', middleName: null, secondLastName: null, nickname: null, displayNameOverride: null } },
      ],
    },
  };
}

const basePerson = {
  id: 'person-1',
  userId: 'user-123',
  name: 'Ada',
  surname: 'Lovelace',
  middleName: null,
  secondLastName: null,
  nickname: null,
  displayNameOverride: null,
  prefix: null,
  suffix: null,
  organization: 'Analytical Engines',
  jobTitle: null,
  photo: 'photo.jpg',
  gender: null,
  anniversary: null,
  lastContact: null,
  notes: 'Likes math',
  contactReminderEnabled: false,
  contactReminderInterval: null,
  contactReminderIntervalUnit: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-02-01'),
  relationshipToUser: { id: 'rt-1', name: 'friend', label: 'Friend' },
  groups: [{ group: { id: 'g-1', name: 'Family' } }],
  relationshipsFrom: [
    {
      relatedPersonId: 'person-2',
      relatedPerson: { id: 'person-2', name: 'Charles', surname: 'Babbage', nickname: null, displayNameOverride: null },
      relationshipType: { id: 'rt-2', name: 'colleague', label: 'Colleague' },
      notes: 'Worked together',
    },
  ],
  importantDates: [{ title: 'Birthday', date: new Date('1815-12-10') }],
  phoneNumbers: [{ type: 'mobile', number: '+44 123' }],
  emails: [],
  addresses: [],
  urls: [],
  imHandles: [],
  aliases: [],
  fieldHistory: [],
  documents: [],
  visits: [{ date: new Date('2025-03-12T00:00:00.000Z'), location: 'Lisbon', motivation: 'Wedding' }],
  locations: [],
  customFields: [],
  customFieldValues: [],
  journalEntries: [entry('j-old', '2024-01-01'), entry('j-new', '2024-06-01')],
};

describe('GET /api/people/[id]/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the person does not exist or is not owned', async () => {
    mocks.personFindUnique.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/people/nope/export'), {
      params: Promise.resolve({ id: 'nope' }),
    });

    expect(response.status).toBe(404);
  });

  it('scopes the lookup to the current user and excludes soft-deleted people', async () => {
    mocks.personFindUnique.mockResolvedValue(basePerson);

    await GET(new Request('http://localhost/api/people/person-1/export'), {
      params: Promise.resolve({ id: 'person-1' }),
    });

    const args = mocks.personFindUnique.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'person-1', userId: 'user-123', deletedAt: null });
    expect(args.include.relationshipsFrom.where).toEqual({ deletedAt: null, relatedPerson: { deletedAt: null } });
    expect(args.include.journalEntries.where).toEqual({ journalEntry: { deletedAt: null } });
  });

  it('exports fields, relationships, notes and journal entries newest first', async () => {
    mocks.personFindUnique.mockResolvedValue(basePerson);

    const response = await GET(new Request('http://localhost/api/people/person-1/export'), {
      params: Promise.resolve({ id: 'person-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe('1.0');
    expect(body.person.name).toBe('Ada');
    expect(body.person.notes).toBe('Likes math');
    expect(body.person.organization).toBe('Analytical Engines');
    expect(body.person.groups).toEqual(['Family']);
    expect(body.person.relationshipToUser).toEqual({ name: 'friend', label: 'Friend' });
    expect(body.person.relationships).toEqual([
      {
        relatedPersonId: 'person-2',
        relatedPersonName: 'Charles Babbage',
        relationshipType: { name: 'colleague', label: 'Colleague' },
        notes: 'Worked together',
      },
    ]);
    expect(body.person.phoneNumbers).toEqual([{ type: 'mobile', number: '+44 123' }]);
    expect(body.person.visits).toEqual([{ date: '2025-03-12', location: 'Lisbon', motivation: 'Wedding' }]);
    expect(body.person.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body.journalEntries.map((e: { id: string }) => e.id)).toEqual(['j-new', 'j-old']);
    expect(body.journalEntries[0].peopleIds).toEqual(['person-1']);
  });
});
