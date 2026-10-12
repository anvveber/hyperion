import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { logger } from '@/lib/logger';
import { newPhoneLogin } from '@/lib/family-members-admin';

// POST /api/admin/family-members/[id]/password - Replace the phone's password with a new one (shown once)
export const POST = withAdmin(async (_request, session, context) => {
  try {
    const { id } = await context.params;
    const member = await prisma.familyMember.findUnique({ where: { id }, select: { username: true, name: true } });
    if (!member) {
      return apiResponse.notFound('Family member not found');
    }
    const login = await newPhoneLogin(member.username, member.name);
    try {
      await prisma.familyMember.update({ where: { id }, data: { passwordHash: login.passwordHash } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return apiResponse.notFound('Family member not found');
      }
      throw error;
    }
    logger.info({ adminId: session.user.id, memberId: id }, 'Family member phone password replaced');
    return apiResponse.ok({ setup: login.setup });
  } catch (error) {
    return handleApiError(error, 'POST /api/admin/family-members/[id]/password');
  }
});
