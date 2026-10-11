import { prisma } from '@/lib/prisma';
import { createPersonVisitSchema, validateRequest } from '@/lib/validations';
import { apiResponse, handleApiError, parseRequestBody, withAuth } from '@/lib/api-utils';

// GET /api/people/[id]/visits - List the places a person went (location history), newest first
export const GET = withAuth(async (_request, session, context) => {
  try {
    const { id } = await context.params;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    // Visits without a date go last
    const visits = await prisma.personVisit.findMany({
      where: { personId: id },
      orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    return apiResponse.ok({ visits });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/visits');
  }
});

// POST /api/people/[id]/visits - Log a place a person went
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
    const validation = validateRequest(createPersonVisitSchema, body);
    if (!validation.success) {
      return validation.response;
    }

    const { date, location, motivation } = validation.data;
    const visit = await prisma.personVisit.create({
      data: {
        personId: id,
        date: date ? new Date(date) : null,
        location,
        motivation: motivation || null,
      },
    });

    return apiResponse.created({ visit });
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/visits');
  }
});
