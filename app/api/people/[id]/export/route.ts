import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { formatCanonicalName } from '@/lib/nameUtils';
import { personExportInclude, serializePersonForExport } from '@/lib/person-export';

// GET /api/people/[id]/export - Export one person's profile as JSON
export const GET = withAuth(async (_request, session, context) => {
  try {
    const { id } = await context.params;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      include: {
        ...personExportInclude,
        journalEntries: {
          where: { journalEntry: { deletedAt: null } },
          include: {
            journalEntry: {
              include: {
                people: {
                  include: {
                    person: {
                      select: { id: true, name: true, surname: true, middleName: true, secondLastName: true, nickname: true, displayNameOverride: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const journalEntries = person.journalEntries
      .map((link) => link.journalEntry)
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date.toISOString(),
        body: e.body,
        people: e.people.map((ep) => formatCanonicalName(ep.person)),
        peopleIds: e.people.map((ep) => ep.person.id),
      }));

    return apiResponse.ok({
      version: '1.0',
      exportDate: new Date().toISOString(),
      person: {
        ...serializePersonForExport(person),
        createdAt: person.createdAt,
        updatedAt: person.updatedAt,
      },
      journalEntries,
    });
  } catch (error) {
    return handleApiError(error, 'people-export');
  }
});
