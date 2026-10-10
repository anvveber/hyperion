import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, parseRequestBody } from '@/lib/api-utils';
import { countAdmins, withAdmin } from '@/lib/admin';
import { adminUpdateUserSchema, validateRequest } from '@/lib/validations';
import { isFeatureEnabled } from '@/lib/features';
import { logger } from '@/lib/logger';

export const PATCH = withAdmin(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const body = await parseRequestBody(request);
    const validation = validateRequest(adminUpdateUserSchema, body);
    if (!validation.success) {
      return validation.response;
    }
    const { role, password } = validation.data;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!target) {
      return apiResponse.notFound('User not found');
    }

    // Never leave the instance without an admin
    if (role === 'USER' && target.role === 'ADMIN' && (await countAdmins()) <= 1) {
      return apiResponse.error('Cannot remove the last admin');
    }

    if (password && !isFeatureEnabled('passwordLogin')) {
      return apiResponse.error('Password login is disabled');
    }

    await prisma.user.update({
      where: { id },
      data: {
        ...(role !== undefined && { role }),
        ...(password !== undefined && {
          password: await bcrypt.hash(password, 10),
          // A reset by the admin also clears any lockout
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      },
    });

    logger.info(
      { adminId: session.user.id, userId: id, roleChanged: role !== undefined, passwordReset: password !== undefined },
      'Admin updated user'
    );

    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'admin-users-update');
  }
});

export const DELETE = withAdmin(async (_request, session, context) => {
  try {
    const { id } = await context.params;

    // Admins delete their own account from Settings > Account, which asks
    // for their password; this keeps the requesting admin in place.
    if (id === session.user.id) {
      return apiResponse.error('Use Settings > Account to delete your own account');
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      return apiResponse.notFound('User not found');
    }

    // Cascades delete all of the user's data
    await prisma.user.delete({ where: { id } });

    logger.info({ adminId: session.user.id, userId: id }, 'Admin deleted user');

    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'admin-users-delete');
  }
});
