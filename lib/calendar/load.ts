import { prisma } from '@/lib/prisma';
import { formatGraphName } from '@/lib/nameUtils';
import { parseCalendarDate } from '@/lib/date-format';
import { getDateDisplayTitle } from '@/lib/important-date-types';
import { getTranslationsForLocale } from '@/lib/i18n-utils';
import { getUserLocale } from '@/lib/locale';
import { isIsoDate } from '@/lib/customFields/values';
import { getCalendarRecurrence, toCalendarParts, type CalendarEvent } from './events';

/**
 * Every important date and DATE custom field of the user's living (not
 * deleted) people, as calendar events.
 */
export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const [user, dates, locale] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { nameOrder: true, nameDisplayFormat: true },
    }),
    prisma.importantDate.findMany({
      where: {
        deletedAt: null,
        person: { userId, deletedAt: null },
      },
      select: {
        id: true,
        title: true,
        type: true,
        date: true,
        reminderType: true,
        reminderInterval: true,
        reminderIntervalUnit: true,
        person: {
          select: {
            id: true,
            name: true,
            surname: true,
            nickname: true,
            displayNameOverride: true,
          },
        },
      },
    }),
    getUserLocale(userId),
  ]);

  // DATE custom fields show up as one-time events titled with the field name
  const customDates = await prisma.personCustomFieldValue.findMany({
    where: {
      template: { userId, type: 'DATE', deletedAt: null },
      person: { userId, deletedAt: null },
    },
    select: {
      id: true,
      value: true,
      template: { select: { name: true } },
      person: {
        select: {
          id: true,
          name: true,
          surname: true,
          nickname: true,
          displayNameOverride: true,
        },
      },
    },
  });

  const tDates = await getTranslationsForLocale(locale, 'people.form.importantDates');

  const importantDateEvents: CalendarEvent[] = dates.map((date) => {
    const parts = toCalendarParts(parseCalendarDate(date.date));
    return {
      id: date.id,
      personId: date.person.id,
      personName: formatGraphName(date.person, user?.nameOrder, user?.nameDisplayFormat),
      title: getDateDisplayTitle(date, tDates),
      ...parts,
      recurrence: getCalendarRecurrence(date, parts.year === null),
    };
  });

  const customFieldEvents: CalendarEvent[] = customDates
    .filter((value) => isIsoDate(value.value))
    .map((value) => ({
      id: `custom-field-${value.id}`,
      personId: value.person.id,
      personName: formatGraphName(value.person, user?.nameOrder, user?.nameDisplayFormat),
      title: value.template.name,
      ...toCalendarParts(parseCalendarDate(value.value)),
      recurrence: null,
    }));

  return [...importantDateEvents, ...customFieldEvents];
}
