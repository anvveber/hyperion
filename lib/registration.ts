import type { UserRole } from '@prisma/client';
import { isSaasMode } from '@/lib/features';

/**
 * Whether someone without an account may create one themselves.
 *
 * The first account on an empty instance can always sign up; it becomes the
 * admin. Self-hosted instances then close public signup for good, and only
 * an admin can create further accounts (Settings > Users). SaaS mode keeps
 * open signup unless DISABLE_REGISTRATION is set.
 */
export function isPublicSignupOpen(userCount: number): boolean {
  if (userCount === 0) return true;
  if (isSaasMode()) return process.env.DISABLE_REGISTRATION !== 'true';
  return false;
}

/** Role for an account created through public signup or a first SSO login. */
export function roleForSignup(userCount: number): UserRole {
  return userCount === 0 ? 'ADMIN' : 'USER';
}
