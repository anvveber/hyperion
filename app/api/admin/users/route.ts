import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, normalizeEmail, parseRequestBody } from '@/lib/api-utils';
import { adminUserSelect, toAdminUser, withAdmin } from '@/lib/admin';
import { adminCreateUserSchema, validateRequest } from '@/lib/validations';
import { isFeatureEnabled } from '@/lib/features';
import { createFreeSubscription } from '@/lib/billing';
import { createPreloadedRelationshipTypes } from '@/lib/relationship-types';
import { logger } from '@/lib/logger';

export const GET = withAdmin(async () => {
  try {
    const users = await prisma.user.findMany({
      select: adminUserSelect,
      orderBy: { createdAt: 'asc' },
    });
    return apiResponse.ok({ users: users.map(toAdminUser) });
  } catch (error) {
    return handleApiError(error, 'admin-users-list');
  }
});

export const POST = withAdmin(async (request, session) => {
  try {
    const body = await parseRequestBody(request);
    const validation = validateRequest(adminCreateUserSchema, body);
    if (!validation.success) {
      return validation.response;
    }

    const { name, surname, password, role } = validation.data;
    const email = normalizeEmail(validation.data.email);

    // Without SSO, a passwordless account could never sign in
    if (!password && !isFeatureEnabled('oidc')) {
      return apiResponse.error('Password is required');
    }
    // With password login disabled, a password would never be usable
    if (password && !isFeatureEnabled('passwordLogin')) {
      return apiResponse.error('Password login is disabled; leave the password empty');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return apiResponse.error('User already exists');
    }

    const created = await prisma.user.create({
      data: {
        email,
        name,
        surname: surname || null,
        password: password ? await bcrypt.hash(password, 10) : null,
        role,
        emailVerified: true,
      },
      select: adminUserSelect,
    });

    await createFreeSubscription(created.id);
    await createPreloadedRelationshipTypes(prisma, created.id);

    logger.info(
      { adminId: session.user.id, userId: created.id, role },
      'Admin created user'
    );

    return apiResponse.created({ user: toAdminUser(created) });
  } catch (error) {
    return handleApiError(error, 'admin-users-create');
  }
});
