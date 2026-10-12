import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/*
 * Shared by the admin API (setting a member's password) and the location
 * server (checking it when a phone sends a position). Only node:crypto, so the
 * location server bundle stays small and has no native dependencies.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** "scrypt$N$r$p$salt$hash", salt and hash in base64. */
export async function hashLocationPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyLocationPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length === 0) return false;
  const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * N * r });
  return timingSafeEqual(key, expected);
}

/** A password that is easy to read aloud and type on a phone: four groups of four. */
export function generateLocationPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  return { username: decoded.slice(0, colon).trim().toLowerCase(), password: decoded.slice(colon + 1) };
}

export interface IncomingPosition {
  lat: number;
  lon: number;
  /** When the phone took the fix */
  at: Date;
  acc: number | null;
  batt: number | null;
}

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read an OwnTracks message. Returns the position for a "location" message,
 * null for any other message type (the apps also send transitions, status and
 * so on, which are accepted and ignored), or "invalid" for a location that
 * cannot be used.
 */
export function parseOwnTracksMessage(body: unknown, nowMs: number = Date.now()): IncomingPosition | null | 'invalid' {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid';
  const m = body as Record<string, unknown>;
  if (m._type !== 'location') return null;
  const lat = num(m.lat);
  const lon = num(m.lon);
  const tst = num(m.tst);
  if (lat === null || lon === null || tst === null) return 'invalid';
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'invalid';
  const atMs = tst * 1000;
  if (atMs <= 0 || atMs > nowMs + MAX_FUTURE_MS) return 'invalid';
  const acc = num(m.acc);
  const batt = num(m.batt);
  return {
    lat,
    lon,
    at: new Date(atMs),
    acc: acc !== null && acc >= 0 ? acc : null,
    batt: batt !== null && batt >= 0 && batt <= 100 ? Math.round(batt) : null,
  };
}

/** Counts failed logins per key and blocks after too many in a window. */
export class FailureLimiter {
  private failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  isBlocked(key: string, nowMs: number = Date.now()): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (entry.resetAt <= nowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.max;
  }

  fail(key: string, nowMs: number = Date.now()): void {
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      this.failures.set(key, { count: 1, resetAt: nowMs + this.windowMs });
    } else {
      entry.count++;
    }
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (v.resetAt <= nowMs) this.failures.delete(k);
    }
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

/**
 * The link the OwnTracks apps open to import their settings. Shown as a QR
 * code when a member's password is set, so the phone needs no typing.
 */
export function ownTracksConfigLink(publicUrl: string, username: string, password: string, name: string): string {
  const config = {
    _type: 'configuration',
    mode: 3, // HTTP
    url: `${publicUrl.replace(/\/+$/, '')}/pub`,
    auth: true,
    username,
    password,
    deviceId: 'phone',
    tid: name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'XX',
  };
  return `owntracks:///config?inline=${Buffer.from(JSON.stringify(config)).toString('base64')}`;
}
