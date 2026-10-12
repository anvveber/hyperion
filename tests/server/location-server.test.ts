// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { createLocationHandler, databaseUrlFromEnv, pgMemberStore, type MemberStore } from '@/server/location-server';
import { hashLocationPassword } from '@/lib/location-ingest';

let server: http.Server;
let base: string;
const store = { findByUsername: vi.fn(), saveLastPosition: vi.fn() } satisfies MemberStore;
let mumHash: string;

const auth = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/pub`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeAll(async () => {
  mumHash = await hashLocationPassword('right-pass');
  server = http.createServer(createLocationHandler(store));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  vi.resetAllMocks();
  store.findByUsername.mockImplementation(async (u: string) => (u === 'mum' ? { id: 'm1', passwordHash: mumHash } : null));
});

const location = { _type: 'location', lat: 41.9, lon: 12.49, tst: Math.floor(Date.now() / 1000), acc: 10, batt: 55 };

describe('location server', () => {
  it('stores a location from a member with the right password and replies with []', async () => {
    const res = await post(location, { authorization: auth('Mum', 'right-pass') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(store.saveLastPosition).toHaveBeenCalledWith('m1', expect.objectContaining({ lat: 41.9, lon: 12.49, acc: 10, batt: 55 }));
  });

  it('accepts and ignores other message types', async () => {
    const res = await post({ _type: 'transition' }, { authorization: auth('mum', 'right-pass') });
    expect(res.status).toBe(200);
    expect(store.saveLastPosition).not.toHaveBeenCalled();
  });

  it('refuses missing or wrong credentials without reading the body', async () => {
    expect((await post(location)).status).toBe(401);
    const wrong = await post(location, { authorization: auth('mum', 'nope') });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('www-authenticate')).toContain('Basic');
    expect((await post(location, { authorization: auth('ghost', 'x') })).status).toBe(401);
    expect(store.saveLastPosition).not.toHaveBeenCalled();
  });

  it('refuses a member with no password yet', async () => {
    store.findByUsername.mockResolvedValue({ id: 'm2', passwordHash: null });
    expect((await post(location, { authorization: auth('dad', '') })).status).toBe(401);
  });

  it('blocks a username after repeated failures', async () => {
    for (let i = 0; i < 10; i++) await post(location, { authorization: auth('brute', 'x') });
    expect((await post(location, { authorization: auth('brute', 'x') })).status).toBe(429);
  });

  it('rejects bad bodies', async () => {
    const a = { authorization: auth('mum', 'right-pass') };
    expect((await post('not json', a)).status).toBe(400);
    expect((await post({ ...location, lat: 200 }, a)).status).toBe(400);
    expect((await post({ _type: 'location', pad: 'x'.repeat(20_000) }, a)).status).toBe(413);
  });

  it('serves only /pub and /health', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/family`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/pub`)).status).toBe(405);
  });
});

describe('databaseUrlFromEnv', () => {
  it('prefers DATABASE_URL and otherwise builds one from DB_* variables', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgresql://x' })).toBe('postgresql://x');
    expect(databaseUrlFromEnv({ DB_HOST: 'db', DB_PORT: '5432', DB_NAME: 'n', DB_USER: 'u', DB_PASSWORD: 'p@ss' })).toBe(
      'postgresql://u:p%40ss@db:5432/n'
    );
    expect(() => databaseUrlFromEnv({})).toThrow();
  });
});

describe('pgMemberStore', () => {
  it('sends the fix time as UTC text, since the column has no time zone', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = pgMemberStore({ query } as unknown as Pool);
    await store.saveLastPosition('m1', { lat: 1, lon: 2, acc: null, batt: null, at: new Date('2026-10-12T14:05:40Z') });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params[5]).toBe('2026-10-12T14:05:40.000Z');
    expect(sql).toContain('"lastAt" <= $6::timestamp');
  });
});
