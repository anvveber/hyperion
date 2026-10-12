import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-tokens', () => ({ resolveApiToken: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { GET as tileGET } from '@/app/api/map/satellite/[z]/[x]/[y]/route';
import { GET as configGET } from '@/app/api/map/config/route';
import { auth } from '@/lib/auth';

const params = (z: string, x: string, y: string) => ({ params: Promise.resolve({ z, x, y }) });
const req = () => new NextRequest('http://localhost/api/map/satellite/3/5/2');

describe('satellite tiles', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'u1', email: 'u@x.y' } } as never);
    process.env.MAP_SATELLITE_URL = 'https://imagery.example/{z}/{y}/{x}.jpg?key=secret';
    fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    delete process.env.MAP_SATELLITE_URL;
    vi.unstubAllGlobals();
  });

  it('passes a tile through from the provider', async () => {
    const res = await tileGET(req(), params('3', '5', '2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock.mock.calls[0][0]).toBe('https://imagery.example/3/2/5.jpg?key=secret');
  });

  it('never tells the browser the provider URL or key', async () => {
    const body = await (await configGET(new NextRequest('http://localhost/api/map/config'), params('', '', ''))).json();
    expect(body).toEqual({ satellite: { attribution: 'Satellite imagery', maxzoom: 19 } });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('refuses tiles out of range or when not configured, without calling the provider', async () => {
    expect((await tileGET(req(), params('3', '8', '0'))).status).toBe(404);
    expect((await tileGET(req(), params('a', '0', '0'))).status).toBe(404);
    delete process.env.MAP_SATELLITE_URL;
    expect((await tileGET(req(), params('3', '5', '2'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not pass on non-images and reports provider failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect((await tileGET(req(), params('3', '5', '2'))).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect((await tileGET(req(), params('3', '5', '2'))).status).toBe(504);
  });

  it('requires a session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await tileGET(req(), params('3', '5', '2'))).status).toBe(401);
  });
});
