import { prisma } from '@/lib/prisma';
import { createFieldHistorySchema, validateRequest } from '@/lib/validations';
import { apiResponse, handleApiError, parseRequestBody, withAuth } from '@/lib/api-utils';
import { isHistoryField } from '@/lib/field-history-fields';

// GET /api/people/[id]/history - List previous values of a person's fields (?field=phone to filter)
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const field = new URL(request.url).searchParams.get('field');
    if (field && !isHistoryField(field)) {
      return apiResponse.error('Unknown field');
    }

    const history = await prisma.personFieldHistory.findMany({
      where: { personId: id, ...(field ? { field } : {}) },
      orderBy: [{ validTo: 'desc' }, { createdAt: 'desc' }],
    });

    return apiResponse.ok({ history });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/history');
  }
});

// POST /api/people/[id]/history - Add a previous value by hand
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const body = await parseRequestBody(request);
    const validation = validateRequest(createFieldHistorySchema, body);
    if (!validation.success) {
      return validation.response;
    }

    const { field, type, value, validFrom, validTo } = validation.data;
    const entry = await prisma.personFieldHistory.create({
      data: {
        personId: id,
        field,
        type: type || null,
        value,
        validFrom: validFrom ? new Date(validFrom) : null,
        validTo: validTo ? new Date(validTo) : null,
      },
    });

    return apiResponse.created({ entry });
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/history');
  }
});
