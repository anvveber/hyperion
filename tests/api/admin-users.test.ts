import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  userDelete: vi.fn(),
  userCount: vi.fn(),
  isFeatureEnabled: vi.fn(),
  deleteUserFiles: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-tokens', () => ({ resolveApiToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findMany: mocks.userFindMany,
      create: mocks.userCreate,
      update: mocks.userUpdate,
      delete: mocks.userDelete,
      count: mocks.userCount,
    },
  },
}));
vi.mock('@/lib/features', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
  isSaasMode: vi.fn(() => false),
}));
vi.mock('@/lib/billing', () => ({ createFreeSubscription: vi.fn() }));
vi.mock('@/lib/person-files', () => ({ deleteUserFiles: mocks.deleteUserFiles }));
vi.mock('@/lib/relationship-types', () => ({ createPreloadedRelationshipTypes: vi.fn() }));
vi.mock('bcryptjs', () => ({
  hash: vi.fn(async () => 'hashed'),
  default: { hash: vi.fn(async () => 'hashed') },
}));

import { GET, POST } from '@/app/api/admin/users/route';
import { PATCH, DELETE } from '@/app/api/admin/users/[id]/route';
import { auth } from '@/lib/auth';
import { resolveApiToken } from '@/lib/api-tokens';

const ADMIN_ID = 'admin1';

function signInAs(id: string, role: 'ADMIN' | 'USER') {
  vi.mocked(auth).mockResolvedValue({ user: { id, email: `${id}@x.y` } } as never);
  // withAdmin's role lookup is the first findUnique of each request
  mocks.userFindUnique.mockResolvedValueOnce({ role });
}

function json(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body !== undefined && {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const row = {
  id: 'u2',
  email: 'new@example.com',
  name: 'New',
  surname: null,
  role: 'USER',
  provider: null,
  password: 'hashed',
  createdAt: new Date('2026-01-01'),
  lastLoginAt: null,
};

describe('/api/admin/users', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isFeatureEnabled.mockImplementation((f: string) => f === 'passwordLogin');
  });

  it('refuses non-admins', async () => {
    signInAs('u1', 'USER');
    const res = await GET(json('GET', 'http://localhost/api/admin/users'));
    expect(res.status).toBe(403);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it('refuses API tokens', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await GET(new NextRequest('http://localhost/api/admin/users', {
      headers: { authorization: 'Bearer ntag_x' },
    }));
    expect(res.status).toBe(401);
    expect(resolveApiToken).not.toHaveBeenCalled();
  });

  it('lists accounts without password hashes', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindMany.mockResolvedValue([row]);

    const res = await GET(json('GET', 'http://localhost/api/admin/users'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.users[0].hasPassword).toBe(true);
    expect(data.users[0].password).toBeUndefined();
  });

  it('creates an account with a hashed password', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce(null); // no existing user
    mocks.userCreate.mockResolvedValue(row);

    const res = await POST(json('POST', 'http://localhost/api/admin/users', {
      email: 'New@Example.com', name: 'New', password: 'ValidPassword123!', role: 'USER',
    }));

    expect(res.status).toBe(201);
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'new@example.com', password: 'hashed', role: 'USER', emailVerified: true }),
    }));
  });

  it('requires a password when SSO is not configured', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    const res = await POST(json('POST', 'http://localhost/api/admin/users', {
      email: 'new@example.com', name: 'New',
    }));
    expect(res.status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('allows a passwordless account when SSO is configured', async () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce(null);
    mocks.userCreate.mockResolvedValue({ ...row, password: null });

    const res = await POST(json('POST', 'http://localhost/api/admin/users', {
      email: 'sso@example.com', name: 'Sso',
    }));

    expect(res.status).toBe(201);
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ password: null }),
    }));
  });

  it('rejects a duplicate email', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'existing' });
    const res = await POST(json('POST', 'http://localhost/api/admin/users', {
      email: 'new@example.com', name: 'New', password: 'ValidPassword123!',
    }));
    expect(res.status).toBe(400);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});

describe('/api/admin/users/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isFeatureEnabled.mockImplementation((f: string) => f === 'passwordLogin');
  });

  it('refuses to demote the last admin', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce({ id: ADMIN_ID, role: 'ADMIN' });
    mocks.userCount.mockResolvedValue(1);

    const res = await PATCH(json('PATCH', 'http://localhost/api/admin/users/admin1', { role: 'USER' }), params(ADMIN_ID));

    expect(res.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('demotes an admin when another admin remains', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u2', role: 'ADMIN' });
    mocks.userCount.mockResolvedValue(2);

    const res = await PATCH(json('PATCH', 'http://localhost/api/admin/users/u2', { role: 'USER' }), params('u2'));

    expect(res.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { role: 'USER' } });
  });

  it('resets a password and clears the lockout', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u2', role: 'USER' });

    const res = await PATCH(json('PATCH', 'http://localhost/api/admin/users/u2', { password: 'NewPassword123!' }), params('u2'));

    expect(res.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { password: 'hashed', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('rejects an empty update', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    const res = await PATCH(json('PATCH', 'http://localhost/api/admin/users/u2', {}), params('u2'));
    expect(res.status).toBe(400);
  });

  it('refuses to delete the requesting admin', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    const res = await DELETE(json('DELETE', 'http://localhost/api/admin/users/admin1'), params(ADMIN_ID));
    expect(res.status).toBe(400);
    expect(mocks.userDelete).not.toHaveBeenCalled();
    expect(mocks.deleteUserFiles).not.toHaveBeenCalled();
  });

  it('deletes another account', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce({ id: 'u2' });
    const res = await DELETE(json('DELETE', 'http://localhost/api/admin/users/u2'), params('u2'));
    expect(res.status).toBe(200);
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: 'u2' } });
    expect(mocks.deleteUserFiles).toHaveBeenCalledWith('u2');
  });

  it('returns 404 for an unknown account', async () => {
    signInAs(ADMIN_ID, 'ADMIN');
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const res = await DELETE(json('DELETE', 'http://localhost/api/admin/users/nope'), params('nope'));
    expect(res.status).toBe(404);
  });
});
