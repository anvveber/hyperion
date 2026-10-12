import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, parseRequestBody } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { familyMemberUpdateSchema, validateRequest } from '@/lib/validations';
import { logger } from '@/lib/logger';
import { familyMemberSelect } from '../route';

// PATCH /api/admin/family-members/[id] - Change a family member
export const PATCH = withAdmin(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const body = await parseRequestBody(request);
    const validation = validateRequest(familyMemberUpdateSchema, body);
    if (!validation.success) {
      return validation.response;
    }
    const data = validation.data;

    if (data.userId && !(await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } }))) {
      return apiResponse.error('Account not found');
    }

    try {
      const member = await prisma.familyMember.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.recorderUser !== undefined && { recorderUser: data.recorderUser }),
          ...(data.recorderDevice !== undefined && { recorderDevice: data.recorderDevice }),
          ...(data.userId !== undefined && { userId: data.userId }),
        },
        select: familyMemberSelect,
      });
      logger.info({ adminId: session.user.id, memberId: id }, 'Family member updated');
      return apiResponse.ok({ member });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return apiResponse.notFound('Family member not found');
        if (error.code === 'P2002') {
          return apiResponse.error('That Recorder user and device, or that account, is already a family member');
        }
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/admin/family-members/[id]');
  }
});

// DELETE /api/admin/family-members/[id] - Stop showing someone (their data on the Recorder is not touched)
export const DELETE = withAdmin(async (_request, session, context) => {
  try {
    const { id } = await context.params;
    try {
      await prisma.familyMember.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return apiResponse.notFound('Family member not found');
      }
      throw error;
    }
    logger.info({ adminId: session.user.id, memberId: id }, 'Family member removed');
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/admin/family-members/[id]');
  }
});
