import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, parseRequestBody } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { familyMemberSchema, validateRequest } from '@/lib/validations';
import { logger } from '@/lib/logger';

export const familyMemberSelect = {
  id: true,
  name: true,
  recorderUser: true,
  recorderDevice: true,
  userId: true,
  user: { select: { email: true, name: true, surname: true } },
} as const;

// GET /api/admin/family-members - Everyone set up for location sharing (no positions)
export const GET = withAdmin(async () => {
  try {
    const [members, users] = await Promise.all([
      prisma.familyMember.findMany({ orderBy: { name: 'asc' }, select: familyMemberSelect }),
      prisma.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, email: true, name: true, surname: true } }),
    ]);
    return apiResponse.ok({ members, users });
  } catch (error) {
    return handleApiError(error, 'GET /api/admin/family-members');
  }
});

// POST /api/admin/family-members - Add someone who shares their location
export const POST = withAdmin(async (request, session) => {
  try {
    const body = await parseRequestBody(request);
    const validation = validateRequest(familyMemberSchema, body);
    if (!validation.success) {
      return validation.response;
    }
    const data = validation.data;

    if (data.userId && !(await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } }))) {
      return apiResponse.error('Account not found');
    }

    try {
      const member = await prisma.familyMember.create({
        data: {
          name: data.name,
          recorderUser: data.recorderUser,
          recorderDevice: data.recorderDevice,
          userId: data.userId ?? null,
        },
        select: familyMemberSelect,
      });
      logger.info({ adminId: session.user.id, memberId: member.id }, 'Family member added');
      return apiResponse.created({ member });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return apiResponse.error('That Recorder user and device, or that account, is already a family member');
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/admin/family-members');
  }
});
