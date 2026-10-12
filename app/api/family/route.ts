import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { isAdmin } from '@/lib/admin';
import { getViewerMembership, isLocationSharingEnabled, lastPositionSelect, toLastPosition } from '@/lib/family-locations';

// GET /api/family - Family members and their last shared positions (only for accounts that share too).
// ?summary=1 answers only whether the feature is on and the viewer can see it.
export const GET = withAuth(async (request, session) => {
  try {
    if (!isLocationSharingEnabled()) {
      return apiResponse.ok({ enabled: false, canView: false, isAdmin: false, members: [] });
    }

    const [membership, admin] = await Promise.all([
      getViewerMembership(session.user.id),
      isAdmin(session.user.id),
    ]);

    // Mutual by design: you see others only while you share yourself.
    if (!membership) {
      return apiResponse.ok({ enabled: true, canView: false, isAdmin: admin, members: [] });
    }

    if (new URL(request.url).searchParams.get('summary') === '1') {
      return apiResponse.ok({ enabled: true, canView: true, isAdmin: admin, members: [] });
    }

    const members = await prisma.familyMember.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, userId: true, ...lastPositionSelect },
    });

    return apiResponse.ok({
      enabled: true,
      canView: true,
      isAdmin: admin,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        isMe: m.userId === session.user.id,
        position: toLastPosition(m),
      })),
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/family');
  }
}, { allowApiToken: false });
