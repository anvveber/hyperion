import type { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiResponse, withAuth, type AuthenticatedHandler } from '@/lib/api-utils';

/** Whether the given user is an instance admin. */
export async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === 'ADMIN';
}

/** Number of admin accounts on the instance. */
export function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: 'ADMIN' } });
}

/**
 * Like {@link withAuth}, but only for admins and only from an interactive
 * session. API tokens are refused so a leaked token can't create accounts.
 */
export function withAdmin(handler: AuthenticatedHandler) {
  return withAuth(
    async (request, session, context) => {
      if (!(await isAdmin(session.user.id))) {
        return apiResponse.forbidden('Admin access required');
      }
      return handler(request, session, context);
    },
    { allowApiToken: false }
  );
}

/** Fields the admin user list needs. The hash is read only to report hasPassword. */
export const adminUserSelect = {
  id: true,
  email: true,
  name: true,
  surname: true,
  role: true,
  provider: true,
  password: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  surname: string | null;
  role: UserRole;
  provider: string | null;
  password: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** Strip the password hash; expose only whether one is set. */
export function toAdminUser({ password, ...rest }: AdminUserRow) {
  return { ...rest, hasPassword: password !== null };
}
