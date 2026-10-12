import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, parseRequestBody, withAuth } from '@/lib/api-utils';
import { personFamilyMemberSchema, validateRequest } from '@/lib/validations';
import { fetchLastPositions, getViewerMembership, isLocationSharingEnabled, positionKey } from '@/lib/family-locations';

// GET /api/people/[id]/location - Last shared position of the family member this person is linked to
export const GET = withAuth(async (_request, session, context) => {
  try {
    const { id } = await context.params;

    if (!isLocationSharingEnabled()) {
      return apiResponse.ok({ enabled: false, canView: false, member: null, position: null, options: [] });
    }

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { familyMember: { select: { id: true, name: true, recorderUser: true, recorderDevice: true } } },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    // Only someone who shares their own location can see, or link, anyone's.
    if (!(await getViewerMembership(session.user.id))) {
      return apiResponse.ok({ enabled: true, canView: false, member: null, position: null, options: [] });
    }

    const [options, positions] = await Promise.all([
      prisma.familyMember.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      person.familyMember ? fetchLastPositions() : Promise.resolve(null),
    ]);

    const member = person.familyMember;
    return apiResponse.ok({
      enabled: true,
      canView: true,
      member: member ? { id: member.id, name: member.name } : null,
      position: member ? positions?.get(positionKey(member)) ?? null : null,
      recorderReachable: member ? positions !== null : true,
      options,
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/location');
  }
}, { allowApiToken: false });

// PUT /api/people/[id]/location - Link this person to a family member, or unlink (null)
export const PUT = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    if (!isLocationSharingEnabled()) {
      return apiResponse.notFound('Location sharing is not configured');
    }
    if (!(await getViewerMembership(session.user.id))) {
      return apiResponse.forbidden('Only people who share their own location can link others');
    }

    const body = await parseRequestBody(request);
    const validation = validateRequest(personFamilyMemberSchema, body);
    if (!validation.success) {
      return validation.response;
    }
    const { familyMemberId } = validation.data;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }
    if (familyMemberId && !(await prisma.familyMember.findUnique({ where: { id: familyMemberId }, select: { id: true } }))) {
      return apiResponse.error('Family member not found');
    }

    await prisma.person.update({ where: { id }, data: { familyMemberId } });
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'PUT /api/people/[id]/location');
  }
}, { allowApiToken: false });
