import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  personFindUnique: vi.fn(),
  personUpdate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-tokens', () => ({ resolveApiToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    familyMember: { findUnique: mocks.memberFindUnique, findMany: mocks.memberFindMany },
    person: { findUnique: mocks.personFindUnique, update: mocks.personUpdate },
  },
}));

import { GET as familyGET } from '@/app/api/family/route';
import { GET as locationGET, PUT as locationPUT } from '@/app/api/people/[id]/location/route';
import { auth } from '@/lib/auth';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const recorder = [{ username: 'mum', device: 'phone', lat: 41.9, lon: 12.49, tst: 100, acc: 8, batt: 70 }];

function signIn() {
  vi.mocked(auth).mockResolvedValue({ user: { id: 'u1', email: 'u1@x.y' } } as never);
  mocks.userFindUnique.mockResolvedValue({ role: 'USER' });
}

describe('family location routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.LOCATION_RECORDER_URL = 'http://recorder:8083';
    fetchMock = vi.fn(async () => new Response(JSON.stringify(recorder)));
    vi.stubGlobal('fetch', fetchMock);
    signIn();
  });

  afterEach(() => {
    delete process.env.LOCATION_RECORDER_URL;
    vi.unstubAllGlobals();
  });

  it('reports the feature off when no Recorder is configured', async () => {
    delete process.env.LOCATION_RECORDER_URL;
    const res = await familyGET(new NextRequest('http://localhost/api/family'), params(''));
    expect(await res.json()).toMatchObject({ enabled: false, canView: false, members: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows nothing to accounts that do not share', async () => {
    mocks.memberFindUnique.mockResolvedValue(null);
    const res = await familyGET(new NextRequest('http://localhost/api/family'), params(''));
    expect(await res.json()).toMatchObject({ enabled: true, canView: false, members: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('answers the summary without asking the Recorder', async () => {
    mocks.memberFindUnique.mockResolvedValue({ id: 'm1' });
    const res = await familyGET(new NextRequest('http://localhost/api/family?summary=1'), params(''));
    expect(await res.json()).toMatchObject({ canView: true, members: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives sharing accounts every member with their last position', async () => {
    mocks.memberFindUnique.mockResolvedValue({ id: 'm1' });
    mocks.memberFindMany.mockResolvedValue([
      { id: 'm1', name: 'Me', recorderUser: 'me', recorderDevice: 'phone', userId: 'u1' },
      { id: 'm2', name: 'Mum', recorderUser: 'mum', recorderDevice: 'phone', userId: null },
    ]);
    const body = await (await familyGET(new NextRequest('http://localhost/api/family'), params(''))).json();
    expect(body.recorderReachable).toBe(true);
    expect(body.members).toEqual([
      { id: 'm1', name: 'Me', isMe: true, position: null },
      { id: 'm2', name: 'Mum', isMe: false, position: { lat: 41.9, lon: 12.49, tst: 100, acc: 8, batt: 70 } },
    ]);
  });

  it('ignores API tokens and requires a session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const req = new NextRequest('http://localhost/api/family', { headers: { authorization: 'Bearer nt_abc' } });
    const res = await familyGET(req, params(''));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides a person\'s location from accounts that do not share', async () => {
    mocks.personFindUnique.mockResolvedValue({ familyMember: { id: 'm2', name: 'Mum', recorderUser: 'mum', recorderDevice: 'phone' } });
    mocks.memberFindUnique.mockResolvedValue(null);
    const body = await (await locationGET(new NextRequest('http://localhost/api/people/p1/location'), params('p1'))).json();
    expect(body).toMatchObject({ enabled: true, canView: false, member: null, position: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a linked person\'s position and only looks up the viewer\'s own, non-deleted people', async () => {
    mocks.personFindUnique.mockResolvedValue({ familyMember: { id: 'm2', name: 'Mum', recorderUser: 'mum', recorderDevice: 'phone' } });
    mocks.memberFindUnique.mockResolvedValue({ id: 'm1' });
    mocks.memberFindMany.mockResolvedValue([{ id: 'm2', name: 'Mum' }]);
    const body = await (await locationGET(new NextRequest('http://localhost/api/people/p1/location'), params('p1'))).json();
    expect(mocks.personFindUnique.mock.calls[0][0].where).toEqual({ id: 'p1', userId: 'u1', deletedAt: null });
    expect(body).toMatchObject({ canView: true, member: { id: 'm2', name: 'Mum' }, position: { lat: 41.9 }, recorderReachable: true });
  });

  it('lets only sharing accounts link people', async () => {
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    const req = () => new NextRequest('http://localhost/api/people/p1/location', {
      method: 'PUT', body: JSON.stringify({ familyMemberId: 'm2' }), headers: { 'content-type': 'application/json' },
    });
    expect((await locationPUT(req(), params('p1'))).status).toBe(403);
    expect(mocks.personUpdate).not.toHaveBeenCalled();

    mocks.memberFindUnique.mockResolvedValueOnce({ id: 'm1' }).mockResolvedValueOnce({ id: 'm2' });
    mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
    expect((await locationPUT(req(), params('p1'))).status).toBe(200);
    expect(mocks.personUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { familyMemberId: 'm2' } });
  });
});
