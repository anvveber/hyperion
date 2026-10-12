import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  memberFindMany: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  memberUpdate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-tokens', () => ({ resolveApiToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findMany: mocks.userFindMany },
    familyMember: {
      findMany: mocks.memberFindMany,
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
    },
  },
}));

import { GET, POST } from '@/app/api/admin/family-members/route';
import { POST as newPassword } from '@/app/api/admin/family-members/[id]/password/route';
import { auth } from '@/lib/auth';
import { verifyLocationPassword } from '@/lib/location-ingest';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const row = {
  id: 'm1', name: 'Nonna', username: 'nonna', passwordHash: 'scrypt$x', userId: null,
  lastAt: new Date('2026-10-12T10:00:00Z'), user: null,
};

function signInAs(role: 'ADMIN' | 'USER') {
  vi.mocked(auth).mockResolvedValue({ user: { id: 'a1', email: 'a@x.y' } } as never);
  mocks.userFindUnique.mockResolvedValueOnce({ role });
}

describe('/api/admin/family-members', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.LOCATION_PUBLIC_URL = 'https://loc.example.org/';
  });
  afterEach(() => {
    delete process.env.LOCATION_PUBLIC_URL;
  });

  it('refuses non-admins', async () => {
    signInAs('USER');
    expect((await GET(new NextRequest('http://localhost/api/admin/family-members'), params(''))).status).toBe(403);
  });

  it('never returns password hashes or positions', async () => {
    signInAs('ADMIN');
    mocks.memberFindMany.mockResolvedValue([row]);
    mocks.userFindMany.mockResolvedValue([]);
    const body = await (await GET(new NextRequest('http://localhost/api/admin/family-members'), params(''))).json();
    expect(body.members[0]).toEqual({
      id: 'm1', name: 'Nonna', username: 'nonna', userId: null, user: null,
      hasPassword: true, lastSeenAt: '2026-10-12T10:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('scrypt');
    expect(body.publicUrl).toBe('https://loc.example.org');
  });

  it('creates a member with a generated password, stores only its hash, and returns the setup once', async () => {
    signInAs('ADMIN');
    mocks.memberCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
    const res = await POST(
      new NextRequest('http://localhost/api/admin/family-members', {
        method: 'POST',
        body: JSON.stringify({ name: 'Nonna', username: 'Nonna' }),
        headers: { 'content-type': 'application/json' },
      }),
      params('')
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const saved = mocks.memberCreate.mock.calls[0][0].data;
    expect(saved.username).toBe('nonna');
    expect(saved.passwordHash).not.toContain(body.setup.password);
    expect(await verifyLocationPassword(body.setup.password, saved.passwordHash)).toBe(true);
    expect(body.setup).toMatchObject({ username: 'nonna', url: 'https://loc.example.org/pub' });
    expect(body.setup.link).toMatch(/^owntracks:\/\/\/config\?inline=/);
    expect(body.member.passwordHash).toBeUndefined();
  });

  it('replaces a phone password', async () => {
    signInAs('ADMIN');
    mocks.memberFindUnique.mockResolvedValue({ username: 'nonna', name: 'Nonna' });
    mocks.memberUpdate.mockResolvedValue({});
    const res = await newPassword(new NextRequest('http://localhost/x', { method: 'POST' }), params('m1'));
    const body = await res.json();
    const hash = mocks.memberUpdate.mock.calls[0][0].data.passwordHash;
    expect(await verifyLocationPassword(body.setup.password, hash)).toBe(true);
  });
});
