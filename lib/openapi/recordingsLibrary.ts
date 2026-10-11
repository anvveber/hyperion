import { jsonBody, jsonResponse, ref400, ref401, ref404, pathParam, resp, sessionOnly, sessionOrToken } from './helpers';

const ref403 = () => resp('Admin access required');

const libraryRecording = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path inside the library archive, YYYY/MM/<name>.mp3' },
    name: { type: 'string' },
    recordedAt: { type: ['string', 'null'], format: 'date-time', description: 'Wall-clock time from the file name, stored as UTC' },
    size: { type: 'integer' },
    durationMs: { type: ['integer', 'null'], description: 'Length, when the search index knows it' },
    hasTranscript: { type: 'boolean' },
    preview: { type: ['string', 'null'], description: 'First words of the transcript' },
  },
  required: ['path', 'name', 'recordedAt', 'size', 'durationMs', 'hasTranscript', 'preview'],
};

const transcriptSegment = {
  type: 'object',
  properties: {
    s: { type: 'integer', description: 'Start, milliseconds from the beginning of the recording' },
    e: { type: 'integer', description: 'End, milliseconds' },
    t: { type: 'string', description: 'Text' },
  },
  required: ['s', 'e', 't'],
};

const libraryDescription =
  'The recordings library is a voice-recording archive on the server, configured with RECORDINGS_LIBRARY_PATH. ' +
  'It is shared by the whole instance, so only admins can use it, and only from a session (no API tokens).';

export function recordingsLibraryPaths(): Record<string, Record<string, unknown>> {
  return {
    '/api/recordings-library': {
      get: {
        tags: ['Photos'],
        summary: 'Recordings library status and months',
        description: `${libraryDescription} Returns whether a library is available, whether it can be searched, and the months that hold recordings, newest first.`,
        security: sessionOnly(),
        responses: {
          '200': jsonResponse('Library status', {
            type: 'object',
            properties: {
              available: { type: 'boolean' },
              searchable: { type: 'boolean', description: 'True when the SQLite FTS5 index is there' },
              months: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { year: { type: 'string' }, month: { type: 'string' }, count: { type: 'integer' } },
                  required: ['year', 'month', 'count'],
                },
              },
            },
            required: ['available', 'searchable', 'months'],
          }),
          '401': ref401(),
          '403': ref403(),
        },
      },
    },
    '/api/recordings-library/month': {
      get: {
        tags: ['Photos'],
        summary: 'Recordings of one month',
        description: `${libraryDescription} Lists the recordings of one month, newest first, with a transcript preview.`,
        security: sessionOnly(),
        parameters: [
          { name: 'year', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{4}$' } },
          { name: 'month', in: 'query', required: true, schema: { type: 'string', pattern: '^(0[1-9]|1[0-2])$' } },
        ],
        responses: {
          '200': jsonResponse('Recordings', {
            type: 'object',
            properties: { recordings: { type: 'array', items: libraryRecording } },
            required: ['recordings'],
          }),
          '400': ref400(),
          '401': ref401(),
          '403': ref403(),
          '404': resp('No recordings library is configured'),
        },
      },
    },
    '/api/recordings-library/search': {
      get: {
        tags: ['Photos'],
        summary: 'Search the transcripts',
        description:
          `${libraryDescription} Full-text search over the transcripts with SQLite FTS5 syntax: AND, OR, NOT (in capitals), ` +
          '"exact phrases", prefix*. Accents are ignored. Up to 50 recordings, newest first. In `snippet`, matches are ' +
          'wrapped in the control characters U+0002 and U+0003.',
        security: sessionOnly(),
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', maxLength: 500 } }],
        responses: {
          '200': jsonResponse('Matching recordings', {
            type: 'object',
            properties: {
              hits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    name: { type: 'string' },
                    recordedAt: { type: ['string', 'null'], format: 'date-time' },
                    durationMs: { type: ['integer', 'null'] },
                    snippet: { type: 'string' },
                  },
                  required: ['path', 'name', 'recordedAt', 'durationMs', 'snippet'],
                },
              },
            },
            required: ['hits'],
          }),
          '400': resp('Missing, too long or malformed query'),
          '401': ref401(),
          '403': ref403(),
          '404': resp('No library, or the library has no search index'),
        },
      },
    },
    '/api/recordings-library/audio': {
      get: {
        tags: ['Photos'],
        summary: 'Stream a library recording',
        description: `${libraryDescription} Streams one recording for preview. Supports Range requests.`,
        security: sessionOnly(),
        parameters: [
          { name: 'path', in: 'query', required: true, schema: { type: 'string' }, description: 'YYYY/MM/<name>.mp3' },
          { name: 'Range', in: 'header', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Audio file', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } },
          '206': { description: 'Requested byte range', content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } } },
          '401': ref401(),
          '403': ref403(),
          '404': resp('Recording not found'),
          '416': resp('Requested range lies outside the file'),
        },
      },
    },
    '/api/people/{id}/audio/library': {
      post: {
        tags: ['Photos'],
        summary: "Add recordings from the library to a person's audio folder",
        description:
          `${libraryDescription} Copies up to 20 recordings into the person's audio folder. Each copy keeps its library path ` +
          'and a copy of its transcript (from the search index when it has the recording, otherwise from the whisper.cpp JSON). ' +
          'Recordings already in the folder are skipped. `results` gives one outcome per path.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: jsonBody({
          type: 'object',
          properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 } },
          required: ['paths'],
        }),
        responses: {
          '200': jsonResponse('What was added', {
            type: 'object',
            properties: {
              audio: { type: 'array', items: { $ref: '#/components/schemas/PersonAudio' } },
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    outcome: { type: 'string', enum: ['added', 'alreadyAdded', 'notFound', 'failed'] },
                  },
                  required: ['path', 'outcome'],
                },
              },
            },
            required: ['audio', 'results'],
          }),
          '400': ref400(),
          '401': ref401(),
          '403': ref403(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/audio/{audioId}/transcript': {
      get: {
        tags: ['Photos'],
        summary: 'Transcript of a recording',
        description: 'Returns the transcript copied with a recording from the recordings library.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('audioId', 'Recording ID')],
        responses: {
          '200': jsonResponse('Transcript', {
            type: 'object',
            properties: {
              language: { type: ['string', 'null'] },
              segments: { type: 'array', items: transcriptSegment },
            },
            required: ['language', 'segments'],
          }),
          '401': ref401(),
          '404': resp('Recording not found, or it has no transcript'),
        },
      },
    },
  };
}
