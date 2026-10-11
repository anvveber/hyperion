import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  visitFindMany: vi.fn(),
  visitFindFirst: vi.fn(),
  visitCreate: vi.fn(),
  visitUpdate: vi.fn(),
  visitDelete: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    person: {
      findUnique: mocks.personFindUnique,
    },
    personVisit: {
      findMany: mocks.visitFindMany,
      findFirst: mocks.visitFindFirst,
      create: mocks.visitCreate,
      update: mocks.visitUpdate,
      delete: mocks.visitDelete,
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

import { GET, POST } from '../../app/api/people/[id]/visits/route';
import { PATCH, DELETE } from '../../app/api/people/[id]/visits/[visitId]/route';

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const personContext = { params: Promise.resolve({ id: 'person-1' }) };
const visitContext = () => ({ params: Promise.resolve({ id: 'person-1', visitId: 'visit-1' }) });

describe('Location history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.personFindUnique.mockResolvedValue({ id: 'person-1' });
    mocks.visitFindFirst.mockResolvedValue({ id: 'visit-1' });
  });

  describe('GET /api/people/[id]/visits', () => {
    it('lists visits newest first with undated ones last', async () => {
      mocks.visitFindMany.mockResolvedValue([
        { id: 'visit-1', personId: 'person-1', date: new Date('2025-03-12'), location: 'Lisbon', motivation: 'Wedding' },
      ]);

      const response = await GET(new Request('http://localhost/api/people/person-1/visits'), personContext);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.visits).toHaveLength(1);
      expect(mocks.visitFindMany).toHaveBeenCalledWith({
        where: { personId: 'person-1' },
        orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      });
    });

    it('only reads people of the current user that are not deleted', async () => {
      mocks.personFindUnique.mockResolvedValue(null);

      const response = await GET(new Request('http://localhost/api/people/person-1/visits'), personContext);

      expect(response.status).toBe(404);
      expect(mocks.personFindUnique).toHaveBeenCalledWith({
        where: { id: 'person-1', userId: 'user-123', deletedAt: null },
        select: { id: true },
      });
      expect(mocks.visitFindMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/people/[id]/visits', () => {
    it('creates a visit with date, location and motivation', async () => {
      mocks.visitCreate.mockResolvedValue({ id: 'visit-1' });

      const response = await POST(
        jsonRequest('http://localhost/api/people/person-1/visits', 'POST', {
          date: '2025-03-12',
          location: '  Lisbon ',
          motivation: 'His sister\'s wedding',
        }),
        personContext
      );

      expect(response.status).toBe(201);
      expect(mocks.visitCreate).toHaveBeenCalledWith({
        data: {
          personId: 'person-1',
          date: new Date('2025-03-12'),
          location: 'Lisbon',
          motivation: 'His sister\'s wedding',
        },
      });
    });

    it('accepts a visit without a date or motivation', async () => {
      mocks.visitCreate.mockResolvedValue({ id: 'visit-1' });

      const response = await POST(
        jsonRequest('http://localhost/api/people/person-1/visits', 'POST', { date: '', location: 'Berlin' }),
        personContext
      );

      expect(response.status).toBe(201);
      expect(mocks.visitCreate).toHaveBeenCalledWith({
        data: { personId: 'person-1', date: null, location: 'Berlin', motivation: null },
      });
    });

    it('rejects a missing location', async () => {
      const response = await POST(
        jsonRequest('http://localhost/api/people/person-1/visits', 'POST', { date: '2025-03-12', location: '  ' }),
        personContext
      );

      expect(response.status).toBe(400);
      expect(mocks.visitCreate).not.toHaveBeenCalled();
    });

    it('rejects an invalid date', async () => {
      const response = await POST(
        jsonRequest('http://localhost/api/people/person-1/visits', 'POST', { date: '12/03/2025', location: 'Lisbon' }),
        personContext
      );

      expect(response.status).toBe(400);
      expect(mocks.visitCreate).not.toHaveBeenCalled();
    });

    it('returns 404 for someone else\'s person', async () => {
      mocks.personFindUnique.mockResolvedValue(null);

      const response = await POST(
        jsonRequest('http://localhost/api/people/person-1/visits', 'POST', { location: 'Lisbon' }),
        personContext
      );

      expect(response.status).toBe(404);
      expect(mocks.visitCreate).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/people/[id]/visits/[visitId]', () => {
    it('updates only the fields that were sent', async () => {
      mocks.visitUpdate.mockResolvedValue({ id: 'visit-1' });

      const response = await PATCH(
        jsonRequest('http://localhost/api/people/person-1/visits/visit-1', 'PATCH', { motivation: 'Conference' }),
        visitContext()
      );

      expect(response.status).toBe(200);
      expect(mocks.visitUpdate).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { motivation: 'Conference' },
      });
    });

    it('clears the date when sent null', async () => {
      mocks.visitUpdate.mockResolvedValue({ id: 'visit-1' });

      await PATCH(
        jsonRequest('http://localhost/api/people/person-1/visits/visit-1', 'PATCH', { date: null }),
        visitContext()
      );

      expect(mocks.visitUpdate).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { date: null },
      });
    });

    it('scopes the lookup to the user and the person', async () => {
      mocks.visitFindFirst.mockResolvedValue(null);

      const response = await PATCH(
        jsonRequest('http://localhost/api/people/person-1/visits/visit-1', 'PATCH', { location: 'Porto' }),
        visitContext()
      );

      expect(response.status).toBe(404);
      expect(mocks.visitFindFirst).toHaveBeenCalledWith({
        where: { id: 'visit-1', personId: 'person-1', person: { userId: 'user-123', deletedAt: null } },
        select: { id: true },
      });
      expect(mocks.visitUpdate).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/people/[id]/visits/[visitId]', () => {
    it('deletes the visit', async () => {
      const response = await DELETE(
        new Request('http://localhost/api/people/person-1/visits/visit-1', { method: 'DELETE' }),
        visitContext()
      );

      expect(response.status).toBe(200);
      expect(mocks.visitDelete).toHaveBeenCalledWith({ where: { id: 'visit-1' } });
    });

    it('returns 404 when the visit does not exist', async () => {
      mocks.visitFindFirst.mockResolvedValue(null);

      const response = await DELETE(
        new Request('http://localhost/api/people/person-1/visits/visit-1', { method: 'DELETE' }),
        visitContext()
      );

      expect(response.status).toBe(404);
      expect(mocks.visitDelete).not.toHaveBeenCalled();
    });
  });
});
