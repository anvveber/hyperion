import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { formatCanonicalName } from '@/lib/nameUtils';
import { personExportInclude, serializePersonForExport } from '@/lib/person-export';

export const GET = withAuth(async (request, session) => {
  try {
    // Parse query params for group filtering
    const { searchParams } = new URL(request.url);
    const groupIdsParam = searchParams.get('groupIds');
    const filterByGroups = groupIdsParam ? groupIdsParam.split(',').filter(Boolean) : null;

    // Fetch all user data
    const [
      user,
      allPeople,
      allGroups,
      relationshipTypes,
      journalEntries,
      customFieldTemplates,
      notificationEndpoints,
      pushSubscriptions,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          email: true,
          name: true,
          theme: true,
          dateFormat: true,
          createdAt: true,
        },
      }),
      prisma.person.findMany({
        where: {
          userId: session.user.id,
          deletedAt: null,
          ...(filterByGroups && filterByGroups.length > 0
            ? {
                groups: {
                  some: {
                    groupId: { in: filterByGroups },
                  },
                },
              }
            : {}),
        },
        include: personExportInclude,
      }),
      prisma.group.findMany({
        where: { userId: session.user.id, deletedAt: null },
      }),
      prisma.relationshipType.findMany({
        where: { userId: session.user.id, deletedAt: null },
      }),
      prisma.journalEntry.findMany({
        where: { userId: session.user.id, deletedAt: null },
        include: {
          people: {
            include: {
              person: {
                select: { id: true, name: true, surname: true, middleName: true, secondLastName: true, nickname: true, displayNameOverride: true },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.customFieldTemplate.findMany({
        where: { userId: session.user.id, deletedAt: null },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      // Notification destinations are user-authored data (the label and the
      // URL are both things the user typed), so a complete copy of what they
      // put into the instance has to include them.
      //
      // `secret` is deliberately absent, and must stay that way. It is
      // write-only from the client's point of view everywhere else in the
      // app: it goes in encrypted and no endpoint reads it back. An export
      // would be the single place it leaked out.
      prisma.notificationEndpoint.findMany({
        where: { userId: session.user.id },
        select: {
          type: true,
          label: true,
          url: true,
          enabled: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Push subscriptions are more marginal, but they are still user-created
      // state someone might reasonably expect to see listed.
      //
      // `endpoint`, `p256dh` and `auth` are all deliberately absent. They are
      // credentials for a push service rather than user data, and `endpoint`
      // in particular is the key the subscribe route upserts on: anyone who
      // learns a victim's endpoint string can move that row to their own
      // account and silently kill the victim's push.
      prisma.pushSubscription.findMany({
        where: { userId: session.user.id },
        select: { userAgent: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Get set of exported person IDs for filtering relationships
    const exportedPersonIds = new Set(allPeople.map((p) => p.id));

    // When filtering by groups, only include those specific groups (not all groups the people belong to)
    const exportedGroupIds = filterByGroups && filterByGroups.length > 0
      ? new Set(filterByGroups)
      : new Set(allPeople.flatMap((p) => p.groups.map((g) => g.group.id)));

    // Filter relationships to only include those between exported people
    // Also filter person's groups to only include the exported groups
    const people = allPeople.map((person) => ({
      ...person,
      groups: person.groups.filter((g) => exportedGroupIds.has(g.group.id)),
      relationshipsFrom: person.relationshipsFrom.filter((rel) =>
        exportedPersonIds.has(rel.relatedPersonId)
      ),
    }));

    // Filter groups to only include the exported groups
    const groups = allGroups.filter((g) => exportedGroupIds.has(g.id));

    // Build export data structure
    const exportData = {
      version: '1.2',
      exportDate: new Date().toISOString(),
      user: {
        email: user?.email,
        name: user?.name,
        theme: user?.theme,
        dateFormat: user?.dateFormat,
        accountCreated: user?.createdAt,
      },
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        color: group.color,
      })),
      people: people.map(serializePersonForExport),
      relationshipTypes: relationshipTypes.map((type) => ({
        id: type.id,
        name: type.name,
        label: type.label,
        color: type.color,
        inverseId: type.inverseId,
      })),
      journalEntries: journalEntries.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date.toISOString(),
        body: e.body,
        // Canonical names keep old-version round-trips working; peopleIds are
        // the stable identity used by import. Display overrides stay out of
        // matching data.
        people: e.people.map((ep) => formatCanonicalName(ep.person)),
        peopleIds: e.people.map((ep) => ep.person.id),
      })),
      customFieldTemplates: customFieldTemplates.map((t) => ({
        name: t.name,
        slug: t.slug,
        type: t.type,
        options: t.options,
        order: t.order,
      })),
      notificationEndpoints,
      pushSubscriptions,
    };

    return apiResponse.ok(exportData);
  } catch (error) {
    return handleApiError(error, 'user-export');
  }
});
