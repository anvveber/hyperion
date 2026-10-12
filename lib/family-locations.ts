import { prisma } from '@/lib/prisma';

/*
 * Family location sharing.
 *
 * The phones send their positions (OwnTracks app in HTTP mode, or
 * hyperion_mobile speaking the same format) to the location server, which
 * listens on its own port (LOCATION_PORT) so it can have its own domain. It
 * stores only the last position of each family member, on the member row.
 *
 * Access is mutual: only accounts that are themselves sharing (linked to a
 * family member) can see anyone's position. Admins manage who is a member
 * but do not see positions unless they share too.
 */

export interface LastPosition {
  lat: number;
  lon: number;
  /** Seconds since the epoch, when the phone took the fix */
  tst: number;
  /** Accuracy in metres, when the phone reported it */
  acc: number | null;
  /** Battery level in percent, when the phone reported it */
  batt: number | null;
}

export function isLocationSharingEnabled(): boolean {
  return Boolean(process.env.LOCATION_PORT?.trim());
}

/** Public address of the location server, for the phone setup QR code. */
export function getLocationPublicUrl(): string | null {
  const url = process.env.LOCATION_PUBLIC_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export const lastPositionSelect = {
  lastLat: true,
  lastLon: true,
  lastAcc: true,
  lastBatt: true,
  lastAt: true,
} as const;

export function toLastPosition(row: {
  lastLat: number | null;
  lastLon: number | null;
  lastAcc: number | null;
  lastBatt: number | null;
  lastAt: Date | null;
}): LastPosition | null {
  if (row.lastLat === null || row.lastLon === null || row.lastAt === null) return null;
  return {
    lat: row.lastLat,
    lon: row.lastLon,
    tst: Math.floor(row.lastAt.getTime() / 1000),
    acc: row.lastAcc,
    batt: row.lastBatt,
  };
}

/** The family member this account shares as, or null when it does not share. */
export async function getViewerMembership(userId: string) {
  return prisma.familyMember.findUnique({ where: { userId }, select: { id: true } });
}
