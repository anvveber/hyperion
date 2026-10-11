import { prisma } from '@/lib/prisma';
import { updatePersonVisitSchema, validateRequest } from '@/lib/validations';
import { apiResponse, handleApiError, parseRequestBody, withAuth } from '@/lib/api-utils';

async function findVisit(userId: string, personId: string, visitId: string) {
  return prisma.personVisit.findFirst({
    where: {
      id: visitId,
      personId,
      person: { userId, deletedAt: null },
    },
    select: { id: true },
  });
}

// PATCH /api/people/[id]/visits/[visitId] - Change the date, location or motivation of a visit
export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id, visitId } = await context.params;

    const visit = await findVisit(session.user.id, id, visitId);
    if (!visit) {
      return apiResponse.notFound('Visit not found');
    }

    const body = await parseRequestBody(request);
    const validation = validateRequest(updatePersonVisitSchema, body);
    if (!validation.success) {
      return validation.response;
    }

    const { date, location, motivation } = validation.data;
    const updated = await prisma.personVisit.update({
      where: { id: visit.id },
      data: {
        ...(date !== undefined ? { date: date ? new Date(date) : null } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(motivation !== undefined ? { motivation: motivation || null } : {}),
      },
    });

    return apiResponse.ok({ visit: updated });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/people/[id]/visits/[visitId]');
  }
});

// DELETE /api/people/[id]/visits/[visitId] - Delete a visit
export const DELETE = withAuth(async (_request, session, context) => {
  try {
    const { id, visitId } = await context.params;

    const visit = await findVisit(session.user.id, id, visitId);
    if (!visit) {
      return apiResponse.notFound('Visit not found');
    }

    await prisma.personVisit.delete({ where: { id: visit.id } });
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/people/[id]/visits/[visitId]');
  }
});
