import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importantDateFindMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    importantDate: { findMany: mocks.importantDateFindMany },
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../../lib/auth', () => ({
  auth: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-123', email: 'test@example.com', name: 'Test' },
    })
  ),
}));

vi.mock('../../lib/locale', () => ({
  getUserLocale: vi.fn(() => Promise.resolve('en')),
}));

vi.mock('../../lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/env')>()),
  getAppUrl: () => 'https://nametag.example.com',
}));

import { GET } from '../../app/api/calendar/ics/route';

describe('GET /api/calendar/ics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ nameOrder: 'WESTERN', nameDisplayFormat: 'FULL' });
  });

  it('returns the user\'s important dates as an .ics attachment', async () => {
    mocks.importantDateFindMany.mockResolvedValue([
      {
        id: 'date-1',
        title: 'Birthday',
        type: 'birthday',
        date: new Date('1990-05-12T00:00:00.000Z'),
        reminderType: null,
        reminderInterval: null,
        reminderIntervalUnit: null,
        person: { id: 'person-1', name: 'Anna', surname: 'Smith', nickname: null, displayNameOverride: null },
      },
      {
        id: 'date-2',
        title: 'Name day',
        type: 'nameday',
        date: new Date('1604-07-26T00:00:00.000Z'),
        reminderType: null,
        reminderInterval: null,
        reminderIntervalUnit: null,
        person: { id: 'person-2', name: 'Ben', surname: null, nickname: null, displayNameOverride: null },
      },
    ]);

    const response = await GET(new Request('http://localhost/api/calendar/ics'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toContain('important-dates.ics');

    const body = await response.text();
    expect(body).toContain('X-WR-CALNAME:Important dates');
    expect(body).toContain('SUMMARY:Birthday: Anna Smith');
    expect(body).toContain('DTSTART;VALUE=DATE:19900512');
    expect(body).toContain('SUMMARY:Name day: Ben');
    expect(body).toContain('DTSTART;VALUE=DATE:20000726');
    expect(body).toContain('URL:https://nametag.example.com/people/person-1');

    expect(mocks.importantDateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, person: { userId: 'user-123', deletedAt: null } },
      })
    );
  });
});
