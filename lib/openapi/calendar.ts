import { ref401, sessionOrToken } from './helpers';

export function calendarPaths(): Record<string, Record<string, unknown>> {
  return {
    '/api/calendar/ics': {
      get: {
        tags: ['Calendar'],
        summary: 'Download important dates as iCalendar',
        description:
          'Returns every important date of the current user\'s people as an iCalendar (.ics) file of all-day events, ready to import into a calendar app. ' +
          'Birthdays, anniversaries, name days, memorials and dates without a known year repeat yearly. A custom date repeats on its recurring reminder\'s interval, ' +
          'is a single event when its reminder fires only once, and repeats yearly when it has no reminder. Event UIDs are stable, so importing the file again updates events instead of duplicating them.',
        security: sessionOrToken(),
        responses: {
          '200': {
            description: 'iCalendar file',
            content: {
              'text/calendar': { schema: { type: 'string' } },
            },
          },
          '401': ref401(),
        },
      },
    },
  };
}
