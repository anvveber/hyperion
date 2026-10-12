// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  FailureLimiter,
  generateLocationPassword,
  hashLocationPassword,
  ownTracksConfigLink,
  parseBasicAuth,
  parseOwnTracksMessage,
  verifyLocationPassword,
} from '@/lib/location-ingest';
import { formatRelativeFromNow, isRecentPosition } from '@/lib/relative-time';

describe('location passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashLocationPassword('abcd-efgh');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyLocationPassword('abcd-efgh', hash)).toBe(true);
    expect(await verifyLocationPassword('abcd-efgx', hash)).toBe(false);
    expect(await verifyLocationPassword('abcd-efgh', 'bcrypt$whatever')).toBe(false);
    expect(await verifyLocationPassword('abcd-efgh', 'scrypt$99999999$8$1$AA==$AA==')).toBe(false);
  });

  it('generates distinct, phone-friendly passwords', () => {
    const a = generateLocationPassword();
    expect(a).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(a).not.toMatch(/[il01o]/);
    expect(generateLocationPassword()).not.toBe(a);
  });
});

describe('parseBasicAuth', () => {
  const header = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`;

  it('reads and lowercases the username, keeps the password as is', () => {
    expect(parseBasicAuth(header('Mum:Pa:ss'))).toEqual({ username: 'mum', password: 'Pa:ss' });
  });

  it('rejects missing or malformed headers', () => {
    for (const bad of [undefined, '', 'Bearer x', header('nocolon'), header(':pw')]) {
      expect(parseBasicAuth(bad)).toBeNull();
    }
  });
});

describe('parseOwnTracksMessage', () => {
  const now = 1_760_000_000_000;

  it('reads a location', () => {
    expect(parseOwnTracksMessage({ _type: 'location', lat: 41.9, lon: 12.49, tst: now / 1000, acc: 12, batt: 80.4 }, now)).toEqual({
      lat: 41.9, lon: 12.49, at: new Date(now), acc: 12, batt: 80,
    });
  });

  it('drops impossible accuracy and battery values', () => {
    expect(parseOwnTracksMessage({ _type: 'location', lat: 1, lon: 1, tst: now / 1000, acc: -1, batt: 140 }, now)).toMatchObject({ acc: null, batt: null });
  });

  it('ignores other message types', () => {
    expect(parseOwnTracksMessage({ _type: 'transition', event: 'enter' }, now)).toBeNull();
    expect(parseOwnTracksMessage({ _type: 'lwt' }, now)).toBeNull();
  });

  it('rejects unusable locations', () => {
    for (const bad of [
      null,
      [],
      { _type: 'location', lat: '41', lon: 12, tst: now / 1000 },
      { _type: 'location', lat: 91, lon: 12, tst: now / 1000 },
      { _type: 'location', lat: 41, lon: 12 },
      { _type: 'location', lat: 41, lon: 12, tst: now / 1000 + 2 * 86400 },
    ]) {
      expect(parseOwnTracksMessage(bad, now)).toBe('invalid');
    }
  });
});

describe('FailureLimiter', () => {
  it('blocks after the limit and resets after the window or a success', () => {
    const l = new FailureLimiter(3, 1000);
    for (let i = 0; i < 3; i++) l.fail('mum', 0);
    expect(l.isBlocked('mum', 10)).toBe(true);
    expect(l.isBlocked('dad', 10)).toBe(false);
    expect(l.isBlocked('mum', 1001)).toBe(false);
    for (let i = 0; i < 3; i++) l.fail('dad', 0);
    l.succeed('dad');
    expect(l.isBlocked('dad', 10)).toBe(false);
  });
});

describe('ownTracksConfigLink', () => {
  it('encodes an HTTP configuration for the app', () => {
    const link = ownTracksConfigLink('https://loc.example.org/', 'nonna', 'pw', 'Nonna Lia');
    expect(link.startsWith('owntracks:///config?inline=')).toBe(true);
    const config = JSON.parse(Buffer.from(link.split('inline=')[1], 'base64').toString());
    expect(config).toEqual({
      _type: 'configuration', mode: 3, url: 'https://loc.example.org/pub', auth: true,
      username: 'nonna', password: 'pw', deviceId: 'phone', tid: 'NO',
    });
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
  });

  it('marks positions older than two hours as not recent', () => {
    expect(isRecentPosition(tst - 7200, now)).toBe(true);
    expect(isRecentPosition(tst - 7201, now)).toBe(false);
  });
});
