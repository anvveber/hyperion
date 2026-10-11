import { prisma } from '@/lib/prisma';
import { updateFieldHistorySchema, validateRequest } from '@/lib/validations';
import { apiResponse, handleApiError, parseRequestBody, withAuth } from '@/lib/api-utils';

async function findEntry(userId: string, personId: string, historyId: string) {
  return prisma.personFieldHistory.findFirst({
    where: {
      id: historyId,
      personId,
      person: { userId, deletedAt: null },
    },
  });
}

// PATCH /api/people/[id]/history/[historyId] - Correct a previous value or its dates
export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id, historyId } = await context.params;

    const entry = await findEntry(session.user.id, id, historyId);
    if (!entry) {
      return apiResponse.notFound('History entry not found');
    }

    const body = await parseRequestBody(request);
    const validation = validateRequest(updateFieldHistorySchema, body);
    if (!validation.success) {
      return validation.response;
    }

    const { type, value, validFrom, validTo } = validation.data;
    const nextFrom = validFrom !== undefined ? (validFrom ? new Date(validFrom) : null) : entry.validFrom;
    const nextTo = validTo !== undefined ? (validTo ? new Date(validTo) : null) : entry.validTo;
    if (nextFrom && nextTo && nextFrom > nextTo) {
      return apiResponse.error('Valid from must be on or before valid to');
    }

    const updated = await prisma.personFieldHistory.update({
      where: { id: entry.id },
      data: {
        ...(type !== undefined ? { type: type || null } : {}),
        ...(value !== undefined ? { value } : {}),
        validFrom: nextFrom,
        validTo: nextTo,
      },
    });

    return apiResponse.ok({ entry: updated });
  } catch (error) {
    return handleApiError(error, 'PATCH /api/people/[id]/history/[historyId]');
  }
});

// DELETE /api/people/[id]/history/[historyId] - Delete a previous value
export const DELETE = withAuth(async (_request, session, context) => {
  try {
    const { id, historyId } = await context.params;

    const entry = await findEntry(session.user.id, id, historyId);
    if (!entry) {
      return apiResponse.notFound('History entry not found');
    }

    await prisma.personFieldHistory.delete({ where: { id: entry.id } });
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/people/[id]/history/[historyId]');
  }
});
