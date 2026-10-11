import { handleApiError, withAuth } from '@/lib/api-utils';
import { getCalendarEvents } from '@/lib/calendar/load';
import { buildIcs } from '@/lib/calendar/ics';
import { getTranslationsForLocale } from '@/lib/i18n-utils';
import { getUserLocale } from '@/lib/locale';
import { getAppUrl } from '@/lib/env';

export const GET = withAuth(async (_request, session) => {
  try {
    const userId = session.user.id;
    const [events, locale] = await Promise.all([
      getCalendarEvents(userId),
      getUserLocale(userId),
    ]);
    const t = await getTranslationsForLocale(locale, 'calendar.ics');

    const ics = buildIcs(events, {
      calendarName: t('calendarName'),
      summary: (event) => t('summary', { name: event.personName, title: event.title }),
      appUrl: getAppUrl(),
    });

    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="important-dates.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleApiError(error, 'calendar-ics');
  }
});
