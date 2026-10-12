import type { Prisma } from '@prisma/client';
import { getLocationPublicUrl } from '@/lib/family-locations';
import { generateLocationPassword, hashLocationPassword, ownTracksConfigLink } from '@/lib/location-ingest';

export const familyMemberSelect = {
  id: true,
  name: true,
  username: true,
  passwordHash: true,
  userId: true,
  lastAt: true,
  user: { select: { email: true, name: true, surname: true } },
} as const;

type MemberRow = Prisma.FamilyMemberGetPayload<{ select: typeof familyMemberSelect }>;

/** What admins see of a member: never the password hash, and no position. */
export function toAdminMember({ passwordHash, lastAt, ...rest }: MemberRow) {
  return { ...rest, hasPassword: passwordHash !== null, lastSeenAt: lastAt?.toISOString() ?? null };
}

/** A fresh password, its hash, and what the admin needs to set up the phone (shown once). */
export async function newPhoneLogin(username: string, name: string) {
  const password = generateLocationPassword();
  const publicUrl = getLocationPublicUrl();
  return {
    passwordHash: await hashLocationPassword(password),
    setup: {
      username,
      password,
      url: publicUrl ? `${publicUrl}/pub` : null,
      link: publicUrl ? ownTracksConfigLink(publicUrl, username, password, name) : null,
    },
  };
}

export const DUPLICATE_MESSAGE = 'That username, or that account, already belongs to a family member';
