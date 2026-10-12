import { prisma } from '@/lib/prisma';
import { createModuleLogger } from '@/lib/logger';

/*
 * Family location sharing, read from an OwnTracks Recorder.
 *
 * The phones send their positions to the Recorder (OwnTracks app, or
 * hyperion_mobile speaking the same format). hyperion only reads the last
 * known position of each family member from the Recorder's API when a page
 * asks for it, and stores none of it. The Recorder's address is internal
 * (same Docker network), set with LOCATION_RECORDER_URL.
 *
 * Access is mutual: only accounts that are themselves sharing (linked to a
 * family member) can see anyone's position. Admins manage who is a member
 * but do not see positions unless they share too.
 */

const log = createModuleLogger('family-locations');

const REQUEST_TIMEOUT_MS = 5000;

export interface LastPosition {
  lat: number;
  lon: number;
  /** Seconds since the epoch, from the phone */
  tst: number;
  /** Accuracy in metres, when the phone reported it */
  acc: number | null;
  /** Battery level in percent, when the phone reported it */
  batt: number | null;
}

/** The Recorder's base URL, or null when location sharing is not configured. */
export function getRecorderUrl(): string | null {
  const url = process.env.LOCATION_RECORDER_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

export function isLocationSharingEnabled(): boolean {
  return getRecorderUrl() !== null;
}

/** The Recorder lowercases user and device names; match it. */
export function normalizeRecorderName(value: string): string {
  return value.trim().toLowerCase();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parse one element of the Recorder's /api/0/last response. */
export function parseLastEntry(entry: unknown): (LastPosition & { user: string; device: string }) | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const lat = finiteNumber(e.lat);
  const lon = finiteNumber(e.lon);
  const tst = finiteNumber(e.tst);
  if (lat === null || lon === null || tst === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (typeof e.username !== 'string' || typeof e.device !== 'string') return null;
  return {
    user: e.username,
    device: e.device,
    lat,
    lon,
    tst,
    acc: finiteNumber(e.acc),
    batt: finiteNumber(e.batt),
  };
}

/**
 * Last positions of everyone the Recorder knows, keyed by "user/device".
 * Returns null when the Recorder is not configured or cannot be reached.
 */
export async function fetchLastPositions(): Promise<Map<string, LastPosition> | null> {
  const base = getRecorderUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/0/last?fields=username,device,lat,lon,tst,acc,batt`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'Recorder answered with an error');
      return null;
    }
    const body: unknown = await res.json();
    const positions = new Map<string, LastPosition>();
    if (Array.isArray(body)) {
      for (const item of body) {
        const parsed = parseLastEntry(item);
        if (!parsed) continue;
        const { user, device, ...position } = parsed;
        positions.set(`${user}/${device}`, position);
      }
    }
    return positions;
  } catch (error) {
    log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Could not reach the Recorder');
    return null;
  }
}

export function positionKey(member: { recorderUser: string; recorderDevice: string }): string {
  return `${member.recorderUser}/${member.recorderDevice}`;
}

/** The family member this account shares as, or null when it does not share. */
export async function getViewerMembership(userId: string) {
  return prisma.familyMember.findUnique({ where: { userId }, select: { id: true } });
}
