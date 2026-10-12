// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { fetchLastPositions, getRecorderUrl, parseLastEntry, positionKey } from '@/lib/family-locations';
import { formatRelativeFromNow, isRecentPosition } from '@/lib/relative-time';

afterEach(() => {
  delete process.env.LOCATION_RECORDER_URL;
  vi.unstubAllGlobals();
});

describe('getRecorderUrl', () => {
  it('is null when unset or blank and strips trailing slashes', () => {
    expect(getRecorderUrl()).toBeNull();
    process.env.LOCATION_RECORDER_URL = '   ';
    expect(getRecorderUrl()).toBeNull();
    process.env.LOCATION_RECORDER_URL = 'http://recorder:8083//';
    expect(getRecorderUrl()).toBe('http://recorder:8083');
  });
});

describe('parseLastEntry', () => {
  it('reads a Recorder entry', () => {
    expect(parseLastEntry({ username: 'mum', device: 'phone', lat: 41.9, lon: 12.49, tst: 1760000000, acc: 12, batt: 80 })).toEqual({
      user: 'mum', device: 'phone', lat: 41.9, lon: 12.49, tst: 1760000000, acc: 12, batt: 80,
    });
  });

  it('treats missing accuracy and battery as null', () => {
    expect(parseLastEntry({ username: 'nonna', device: 'iphone', lat: 43.7, lon: 11.2, tst: 1 })).toMatchObject({ acc: null, batt: null });
  });

  it('rejects entries without a usable position or identity', () => {
    for (const bad of [
      null,
      'x',
      { username: 'a', device: 'b', lat: '41', lon: 12, tst: 1 },
      { username: 'a', device: 'b', lat: 91, lon: 12, tst: 1 },
      { username: 'a', device: 'b', lat: 41, lon: 181, tst: 1 },
      { username: 'a', device: 'b', lat: 41, lon: 12 },
      { device: 'b', lat: 41, lon: 12, tst: 1 },
    ]) {
      expect(parseLastEntry(bad)).toBeNull();
    }
  });
});

describe('fetchLastPositions', () => {
  it('returns null without a Recorder, without calling it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchLastPositions()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys positions by user/device and skips bad entries', async () => {
    process.env.LOCATION_RECORDER_URL = 'http://recorder:8083/';
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify([
        { username: 'mum', device: 'phone', lat: 41.9, lon: 12.49, tst: 100, acc: 5, batt: 50 },
        { username: 'broken', device: 'phone' },
      ]))
    );
    vi.stubGlobal('fetch', fetchMock);
    const positions = await fetchLastPositions();
    expect(fetchMock.mock.calls[0][0]).toBe('http://recorder:8083/api/0/last?fields=username,device,lat,lon,tst,acc,batt');
    expect(positions?.size).toBe(1);
    expect(positions?.get(positionKey({ recorderUser: 'mum', recorderDevice: 'phone' }))).toEqual({ lat: 41.9, lon: 12.49, tst: 100, acc: 5, batt: 50 });
  });

  it('returns null when the Recorder errors or is unreachable', async () => {
    process.env.LOCATION_RECORDER_URL = 'http://recorder:8083';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    expect(await fetchLastPositions()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await fetchLastPositions()).toBeNull();
  });
});

describe('relative time', () => {
  const now = 1_760_000_000_000;
  const tst = now / 1000;

  it('formats in the given locale', () => {
    expect(formatRelativeFromNow(tst - 10, 'en', now)).toBe('now');
    expect(formatRelativeFromNow(tst - 5 * 60, 'en', now)).toBe('5 minutes ago');
    expect(formatRelativeFromNow(tst - 3 * 3600, 'en', now)).toBe('3 hours ago');
    expect(formatRelativeFromNow(tst - 86400, 'en', now)).toBe('yesterday');
    expect(formatRelativeFromNow(tst + 600, 'en', now)).toBe('now');
  });

  it('marks positions older than two hours as not recent', () => {
    expect(isRecentPosition(tst - 7200, now)).toBe(true);
    expect(isRecentPosition(tst - 7201, now)).toBe(false);
  });
});
