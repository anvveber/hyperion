import {
  createPersonSchema, updatePersonSchema, deletePersonSchema,
  createImportantDateSchema, updateImportantDateSchema,
  createFieldHistorySchema, updateFieldHistorySchema,
  createPersonVisitSchema, updatePersonVisitSchema,
  mergePersonSchema,
} from '../validations';
import { zodBody, jsonBody, pathParam, jsonResponse, ref400, ref401, ref404, refMessage, refGraph, refSuccess, resp, sessionOrToken } from './helpers';
import { DEFAULT_PEOPLE_PAGE_SIZE, MAX_PEOPLE_PAGE_SIZE } from '../constants';

export function peoplePaths(): Record<string, Record<string, unknown>> {
  return {
    '/api/people': {
      get: {
        tags: ['People'],
        summary: 'List people',
        description:
          'Returns a page of people belonging to the authenticated user, sorted alphabetically by name. ' +
          `Defaults to ${DEFAULT_PEOPLE_PAGE_SIZE} per page; pass \`limit\` and \`offset\` to walk the rest. ` +
          'Includes relationship-to-user info and group memberships.',
        security: sessionOrToken(),
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: MAX_PEOPLE_PAGE_SIZE, default: DEFAULT_PEOPLE_PAGE_SIZE },
            description: `Page size. Values above ${MAX_PEOPLE_PAGE_SIZE} are capped.`,
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', minimum: 0, default: 0 },
            description: 'Number of people to skip before the page starts.',
          },
          {
            name: 'groupIds',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated group IDs. Only people in at least one of them are returned.',
          },
          {
            name: 'includeDetails',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Set to false to omit multi-value fields (phones, emails, addresses) for a lighter response.',
          },
          {
            name: 'includeAll',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description:
              'Export mode: adds important dates, relationships, and custom field values, and returns every person ' +
              'rather than a page (so an export is never silently truncated). The `pagination` object is omitted. ' +
              'An explicit `limit` still applies.',
          },
        ],
        responses: {
          '200': jsonResponse('Page of people', {
            type: 'object',
            properties: {
              people: { type: 'array', items: { $ref: '#/components/schemas/Person' } },
              pagination: {
                type: 'object',
                description: 'Omitted when includeAll=true is used without an explicit limit.',
                properties: {
                  total: { type: 'integer', description: 'People matching the filter, ignoring the page.' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                  hasMore: { type: 'boolean' },
                },
              },
            },
          }),
          '400': ref400(),
          '401': ref401(),
        },
      },
      post: {
        tags: ['People'],
        summary: 'Create a new person',
        description: 'Adds a new person to your network. Can include group memberships, important dates, and a relationship type to you (or connected through another person).',
        security: sessionOrToken(),
        requestBody: zodBody(createPersonSchema),
        responses: {
          '201': jsonResponse('Person created', {
            type: 'object',
            properties: { person: { $ref: '#/components/schemas/Person' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '403': resp('Plan limit reached'),
        },
      },
    },
    '/api/people/{id}': {
      get: {
        tags: ['People'],
        summary: 'Get a person by ID',
        description: 'Returns full details for a single person, including their relationships, groups, and important dates.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Person details', {
            type: 'object',
            properties: { person: { $ref: '#/components/schemas/Person' } },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      put: {
        tags: ['People'],
        summary: 'Update a person',
        description: 'Updates any fields of an existing person. Group memberships and important dates are replaced in full when provided.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(updatePersonSchema),
        responses: {
          '200': jsonResponse('Person updated', {
            type: 'object',
            properties: { person: { $ref: '#/components/schemas/Person' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['People'],
        summary: 'Delete a person',
        description: 'Soft-deletes a person. Optionally also deletes orphaned people who were only connected through this person.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(deletePersonSchema),
        responses: {
          '200': refMessage(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/restore': {
      post: {
        tags: ['People'],
        summary: 'Restore a deleted person',
        description: 'Restores a soft-deleted person back to active status.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Person restored', {
            type: 'object',
            properties: { person: { $ref: '#/components/schemas/Person' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/permanent': {
      delete: {
        tags: ['People'],
        summary: 'Permanently delete a person',
        description: 'Permanently deletes a soft-deleted person and all related records (photos, groups, relationships, important dates, etc). This cannot be undone.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': refSuccess(),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/search': {
      get: {
        tags: ['People'],
        summary: 'Search people by name',
        description: 'Searches across name, surname, middle name, second last name, and nickname. Case-insensitive. Returns up to 20 results.',
        security: sessionOrToken(),
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Search query (min 1 character)' },
        ],
        responses: {
          '200': jsonResponse('Search results', {
            type: 'object',
            properties: {
              people: { type: 'array', items: { $ref: '#/components/schemas/PersonSummary' } },
            },
          }),
          '401': ref401(),
        },
      },
    },
    '/api/people/search-index': {
      get: {
        tags: ['People'],
        summary: 'Get search index data',
        description:
          'Returns all searchable data for the authenticated user\'s contacts in a flat, ' +
          'denormalized format optimized for client-side indexing. Multi-value fields ' +
          '(phones, emails, addresses, etc.) are joined into single strings.',
        security: sessionOrToken(),
        responses: {
          '200': jsonResponse('Search index data', {
            type: 'object',
            properties: {
              people: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    surname: { type: 'string', nullable: true },
                    middleName: { type: 'string', nullable: true },
                    secondLastName: { type: 'string', nullable: true },
                    nickname: { type: 'string', nullable: true },
                    organization: { type: 'string', nullable: true },
                    jobTitle: { type: 'string', nullable: true },
                    notes: { type: 'string', nullable: true },
                    phones: { type: 'string', description: 'All phone numbers, space-joined' },
                    emails: { type: 'string', description: 'All email addresses, space-joined' },
                    addresses: { type: 'string', description: 'All address components, space-joined' },
                    urls: { type: 'string', description: 'All URLs, space-joined' },
                    imHandles: { type: 'string', description: 'All IM handles, space-joined' },
                    groups: { type: 'string', description: 'All group names, space-joined' },
                    customFields: { type: 'string', description: 'All custom field key-value pairs, space-joined' },
                    photo: { type: 'string', nullable: true },
                  },
                  required: ['id', 'name', 'phones', 'emails', 'addresses', 'urls', 'imHandles', 'groups', 'customFields'],
                },
              },
            },
          }),
          '401': ref401(),
        },
      },
    },
    '/api/people/{id}/orphans': {
      get: {
        tags: ['People'],
        summary: 'Find orphaned connections',
        description: 'Returns people who are only connected to the network through this person. Useful before deletion to warn about people who would become disconnected.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Orphan list', {
            type: 'object',
            properties: {
              orphans: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    fullName: { type: 'string' },
                  },
                },
              },
            },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/export': {
      get: {
        tags: ['People'],
        summary: 'Export a person as JSON',
        description:
          'Returns one person\'s full profile: all fields, contact details, important dates, groups, relationships (with notes) ' +
          'and the journal entries that mention them. Photo files are not included, only the stored photo reference.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Person export', {
            type: 'object',
            properties: {
              version: { type: 'string' },
              exportDate: { type: 'string', format: 'date-time' },
              person: { type: 'object', description: 'Same person shape as in GET /api/user/export, plus createdAt and updatedAt' },
              journalEntries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    date: { type: 'string', format: 'date-time' },
                    body: { type: 'string' },
                    people: { type: 'array', items: { type: 'string' } },
                    peopleIds: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/pdf': {
      get: {
        tags: ['People'],
        summary: 'Download a person as a PDF',
        description:
          'Returns one person\'s profile as an A4 PDF in the user\'s language and date format: details, contact information, ' +
          'previous values, important dates, custom fields, location history, notes, relationships, journal entries, the names ' +
          'of attached documents and recordings, and up to 24 attached images. With `transcripts=1`, the transcripts of ' +
          'recordings added from the recordings library are appended. Sent as an attachment.',
        security: sessionOrToken(),
        parameters: [
          pathParam('id', 'Person ID'),
          { name: 'transcripts', in: 'query', required: false, schema: { type: 'string', enum: ['1'] }, description: 'Append recording transcripts' },
        ],
        responses: {
          '200': {
            description: 'The PDF file',
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
          },
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/bulk': {
      post: {
        tags: ['People'],
        summary: 'Bulk actions on people',
        description: 'Perform bulk operations on multiple people. Supports delete (soft-delete with optional orphan and CardDAV cleanup), add to groups, and set relationship type. Specify either personIds or selectAll: true.',
        security: sessionOrToken(),
        requestBody: jsonBody({
          type: 'object',
          required: ['action'],
          discriminator: { propertyName: 'action' },
          oneOf: [
            {
              type: 'object',
              required: ['action'],
              properties: {
                action: { type: 'string', enum: ['delete'] },
                personIds: { type: 'array', items: { type: 'string' } },
                selectAll: { type: 'boolean' },
                deleteOrphans: { type: 'boolean' },
                orphanIds: { type: 'array', items: { type: 'string' } },
                deleteFromCardDav: { type: 'boolean' },
              },
            },
            {
              type: 'object',
              required: ['action', 'groupIds'],
              properties: {
                action: { type: 'string', enum: ['addToGroups'] },
                personIds: { type: 'array', items: { type: 'string' } },
                selectAll: { type: 'boolean' },
                groupIds: { type: 'array', items: { type: 'string' } },
              },
            },
            {
              type: 'object',
              required: ['action', 'relationshipTypeId'],
              properties: {
                action: { type: 'string', enum: ['setRelationship'] },
                personIds: { type: 'array', items: { type: 'string' } },
                selectAll: { type: 'boolean' },
                relationshipTypeId: { type: 'string' },
              },
            },
          ],
        }),
        responses: {
          '200': jsonResponse('Bulk action result', {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              affectedCount: { type: 'integer' },
            },
          }),
          '400': { description: 'Validation error' },
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/bulk/orphans': {
      post: {
        tags: ['People'],
        summary: 'Find orphans for bulk deletion',
        description: 'Computes the aggregate list of people who would become disconnected from the network if the specified people were deleted. Used to warn before bulk delete.',
        security: sessionOrToken(),
        requestBody: jsonBody({
          type: 'object',
          properties: {
            personIds: { type: 'array', items: { type: 'string' } },
            selectAll: { type: 'boolean' },
          },
        }),
        responses: {
          '200': jsonResponse('Orphan check result', {
            type: 'object',
            properties: {
              orphans: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    fullName: { type: 'string' },
                  },
                },
              },
              hasCardDavSync: { type: 'boolean' },
            },
          }),
          '400': { description: 'Validation error' },
          '401': ref401(),
        },
      },
    },
    '/api/people/{id}/graph': {
      get: {
        tags: ['People'],
        summary: 'Get relationship graph for a person',
        description: 'Returns a D3-compatible graph (nodes and edges) centered on the specified person, showing their direct connections.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': refGraph(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Duplicates & Merge
    '/api/people/duplicates': {
      get: {
        tags: ['People'],
        summary: 'Find all duplicate contact groups',
        description: 'Scans all contacts and returns groups of potential duplicates based on name, email, phone, and birthday similarity. Dismissed pairs are excluded.',
        security: sessionOrToken(),
        responses: {
          '200': jsonResponse('Duplicate groups', {
            type: 'object',
            properties: {
              groups: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    people: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          surname: { type: 'string', nullable: true },
                        },
                      },
                    },
                    similarity: { type: 'number', description: 'Score between 0 and 1' },
                  },
                },
              },
            },
          }),
          '401': ref401(),
        },
      },
    },
    '/api/people/{id}/duplicates': {
      get: {
        tags: ['People'],
        summary: 'Find duplicate candidates for a person',
        description: 'Returns contacts similar to the specified person, sorted by similarity descending. Dismissed pairs are excluded.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Duplicate candidates', {
            type: 'object',
            properties: {
              duplicates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    personId: { type: 'string' },
                    name: { type: 'string' },
                    surname: { type: 'string', nullable: true },
                    similarity: { type: 'number', description: 'Score between 0 and 1' },
                  },
                },
              },
            },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/duplicates/dismiss': {
      post: {
        tags: ['People'],
        summary: 'Dismiss a duplicate pair',
        description: 'Marks two contacts as not duplicates so they no longer appear in duplicate detection results.',
        security: sessionOrToken(),
        requestBody: jsonBody({
          type: 'object',
          required: ['personAId', 'personBId'],
          properties: {
            personAId: { type: 'string', description: 'ID of the first person' },
            personBId: { type: 'string', description: 'ID of the second person' },
          },
        }),
        responses: {
          '200': jsonResponse('Pair dismissed', {
            type: 'object',
            properties: {
              dismissed: { type: 'boolean' },
            },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/merge': {
      post: {
        tags: ['People'],
        summary: 'Merge two contacts',
        description: 'Merges the secondary contact into the primary contact. Relationships, groups, multi-value fields, and important dates are transferred. The secondary contact is soft-deleted after merge.',
        security: sessionOrToken(),
        requestBody: zodBody(mergePersonSchema),
        responses: {
          '200': jsonResponse('Merge result', {
            type: 'object',
            properties: {
              person: { $ref: '#/components/schemas/Person' },
            },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Important Dates
    '/api/people/{id}/important-dates': {
      get: {
        tags: ['Important Dates'],
        summary: 'List important dates for a person',
        description: 'Returns all important dates associated with a person, sorted by date ascending.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Important dates list', {
            type: 'object',
            properties: {
              importantDates: { type: 'array', items: { $ref: '#/components/schemas/ImportantDate' } },
            },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      post: {
        tags: ['Important Dates'],
        summary: 'Create an important date',
        description: 'Adds a new important date to a person with optional reminder configuration.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(createImportantDateSchema),
        responses: {
          '201': jsonResponse('Important date created', {
            type: 'object',
            properties: { importantDate: { $ref: '#/components/schemas/ImportantDate' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '403': resp('Reminder limit reached'),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/important-dates/{dateId}': {
      put: {
        tags: ['Important Dates'],
        summary: 'Update an important date',
        description: 'Updates the title, date, and/or reminder settings for an important date.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('dateId', 'Important date ID')],
        requestBody: zodBody(updateImportantDateSchema),
        responses: {
          '200': jsonResponse('Important date updated', {
            type: 'object',
            properties: { importantDate: { $ref: '#/components/schemas/ImportantDate' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['Important Dates'],
        summary: 'Delete an important date',
        description: 'Soft-deletes an important date. Can be restored within the retention period.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('dateId', 'Important date ID')],
        responses: {
          '200': refMessage(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/important-dates/{dateId}/restore': {
      post: {
        tags: ['Important Dates'],
        summary: 'Restore a deleted important date',
        description: 'Restores a soft-deleted important date.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('dateId', 'Important date ID')],
        responses: {
          '200': jsonResponse('Important date restored', {
            type: 'object',
            properties: { importantDate: { $ref: '#/components/schemas/ImportantDate' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    '/api/people/{id}/important-dates/{dateId}/permanent': {
      delete: {
        tags: ['Important Dates'],
        summary: 'Permanently delete an important date',
        description: 'Permanently deletes a soft-deleted important date. This cannot be undone.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('dateId', 'Important date ID')],
        responses: {
          '200': refSuccess(),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Field history
    '/api/people/{id}/history': {
      get: {
        tags: ['People'],
        summary: 'List previous field values',
        description: 'Returns previous values of name, nickname, organization, job title, phone numbers, emails, addresses, websites and IM handles. Values are kept automatically when they are changed or removed. Newest first.',
        security: sessionOrToken(),
        parameters: [
          pathParam('id', 'Person ID'),
          {
            name: 'field',
            in: 'query',
            required: false,
            description: 'Only return entries for this field',
            schema: { type: 'string', enum: ['name', 'nickname', 'organization', 'jobTitle', 'phone', 'email', 'address', 'url', 'im'] },
          },
        ],
        responses: {
          '200': jsonResponse('Field history', {
            type: 'object',
            properties: {
              history: { type: 'array', items: { $ref: '#/components/schemas/PersonFieldHistory' } },
            },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
      post: {
        tags: ['People'],
        summary: 'Add a previous field value',
        description: 'Records a previous value by hand, for example an old address. Dates are calendar dates (YYYY-MM-DD).',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(createFieldHistorySchema),
        responses: {
          '201': jsonResponse('History entry created', {
            type: 'object',
            properties: { entry: { $ref: '#/components/schemas/PersonFieldHistory' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/history/{historyId}': {
      patch: {
        tags: ['People'],
        summary: 'Update a previous field value',
        description: 'Corrects the value, label or valid-from / valid-to dates of a history entry. Send an empty string or null to clear a date.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('historyId', 'History entry ID')],
        requestBody: zodBody(updateFieldHistorySchema),
        responses: {
          '200': jsonResponse('History entry updated', {
            type: 'object',
            properties: { entry: { $ref: '#/components/schemas/PersonFieldHistory' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['People'],
        summary: 'Delete a previous field value',
        description: 'Permanently deletes a history entry.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('historyId', 'History entry ID')],
        responses: {
          '200': refSuccess(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Location history
    '/api/people/{id}/visits': {
      get: {
        tags: ['People'],
        summary: 'List location history',
        description: 'Returns the places a person went, with the date and the reason for going. Newest first; visits without a date come last.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Location history', {
            type: 'object',
            properties: {
              visits: { type: 'array', items: { $ref: '#/components/schemas/PersonVisit' } },
            },
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      post: {
        tags: ['People'],
        summary: 'Add a visit to location history',
        description: 'Logs a place a person went. The date is a calendar date (YYYY-MM-DD) and optional.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(createPersonVisitSchema),
        responses: {
          '201': jsonResponse('Visit created', {
            type: 'object',
            properties: { visit: { $ref: '#/components/schemas/PersonVisit' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/visits/{visitId}': {
      patch: {
        tags: ['People'],
        summary: 'Update a visit',
        description: 'Changes the date, location or motivation of a visit. Send an empty string or null to clear the date or motivation.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('visitId', 'Visit ID')],
        requestBody: zodBody(updatePersonVisitSchema),
        responses: {
          '200': jsonResponse('Visit updated', {
            type: 'object',
            properties: { visit: { $ref: '#/components/schemas/PersonVisit' } },
          }),
          '400': ref400(),
          '401': ref401(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['People'],
        summary: 'Delete a visit',
        description: 'Permanently deletes a visit from location history.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('visitId', 'Visit ID')],
        responses: {
          '200': refSuccess(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Photos (person-specific)
    '/api/people/{id}/photo': {
      post: {
        tags: ['Photos'],
        summary: 'Upload or replace a person photo',
        description: 'Upload a photo for a person. The image is cropped to 256x256, converted to JPEG, and EXIF data is stripped.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  photo: {
                    type: 'string',
                    format: 'binary',
                    description: 'Photo image file',
                  },
                },
                required: ['photo'],
              },
            },
          },
        },
        responses: {
          '200': jsonResponse('Photo uploaded', {
            type: 'object',
            properties: {
              photo: { type: 'string', description: 'Saved photo filename' },
            },
            required: ['photo'],
          }),
          '400': resp('Validation error or invalid image'),
          '401': ref401(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['Photos'],
        summary: 'Remove a person photo',
        description: 'Deletes the photo associated with a person.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': refMessage(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Document folder (person-specific)
    '/api/people/{id}/documents': {
      get: {
        tags: ['Photos'],
        summary: "List a person's documents",
        description: "Returns the files in a person's document folder, newest first.",
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Document list', {
            type: 'object',
            properties: {
              documents: { type: 'array', items: { $ref: '#/components/schemas/PersonDocument' } },
            },
            required: ['documents'],
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      post: {
        tags: ['Photos'],
        summary: "Add a file to a person's document folder",
        description:
          'Upload one file of any type, up to 200MB. The file is stored as uploaded and named by its SHA-256 hash, ' +
          'so identical files are kept on disk once per account. Images (JPEG, PNG, GIF, WebP, AVIF) get a 400x400 thumbnail. ' +
          'Uploading a file this person already has returns the existing entry with `duplicate: true` and status 200. ' +
          'The type is detected from the file content; the browser-supplied type is only used for formats that are not recognised. ' +
          'A person can hold up to 1000 documents.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary', description: 'The file; its name is kept as originalName' },
                },
                required: ['file'],
              },
            },
          },
        },
        responses: {
          '200': jsonResponse('The person already has this file', {
            type: 'object',
            properties: {
              document: { $ref: '#/components/schemas/PersonDocument' },
              duplicate: { type: 'boolean', const: true },
            },
            required: ['document', 'duplicate'],
          }),
          '201': jsonResponse('Document added', {
            type: 'object',
            properties: {
              document: { $ref: '#/components/schemas/PersonDocument' },
              duplicate: { type: 'boolean', const: false },
            },
            required: ['document', 'duplicate'],
          }),
          '400': resp('Validation error, empty or too large file, or folder full'),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/documents/{documentId}': {
      get: {
        tags: ['Photos'],
        summary: 'Get a document file',
        description:
          'Serves the stored file with its detected Content-Type. Supports a single HTTP Range for seeking in video and audio. ' +
          'Images, PDF, common video and audio formats and plain text are served inline; everything else as an attachment. ' +
          'Pass `size=thumb` for an image thumbnail, or `download=1` to always get an attachment.',
        security: sessionOrToken(),
        parameters: [
          pathParam('id', 'Person ID'),
          pathParam('documentId', 'Document ID'),
          {
            name: 'size',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['thumb'] },
            description: 'Return the thumbnail (JPEG or PNG) instead of the file. 404 when the document has none.',
          },
          {
            name: 'download',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['1'] },
            description: 'Serve with Content-Disposition: attachment',
          },
          {
            name: 'Range',
            in: 'header',
            required: false,
            schema: { type: 'string', example: 'bytes=0-1048575' },
            description: 'Single byte range',
          },
        ],
        responses: {
          '200': {
            description: 'The whole file',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
          '206': {
            description: 'Part of the file (Range request)',
            content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
          },
          '401': ref401(),
          '404': resp('Document not found'),
          '416': resp('Range outside the file'),
        },
      },
      delete: {
        tags: ['Photos'],
        summary: "Delete a file from a person's document folder",
        description: 'Removes the document entry. The file on disk is deleted once no other document in the account uses the same content.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('documentId', 'Document ID')],
        responses: {
          '200': refSuccess(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },

    // Audio folder (person-specific)
    '/api/people/{id}/audio': {
      get: {
        tags: ['Photos'],
        summary: "List a person's audio recordings",
        description:
          "Returns the recordings in a person's audio folder, newest recording first. Files without a date in their name come last.",
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Recording list', {
            type: 'object',
            properties: {
              audio: { type: 'array', items: { $ref: '#/components/schemas/PersonAudio' } },
            },
            required: ['audio'],
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      post: {
        tags: ['Photos'],
        summary: "Add a recording to a person's audio folder",
        description:
          'Upload one MP3 file (up to 200MB). The file is stored as is. When its name starts with YYMMDD_HHMM ' +
          '(for example `241005_1430.mp3`), that date and time is saved as `recordedAt`. A person can hold up to 1000 recordings.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  audio: { type: 'string', format: 'binary', description: 'MP3 file' },
                },
                required: ['audio'],
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('Recording added', {
            type: 'object',
            properties: { audio: { $ref: '#/components/schemas/PersonAudio' } },
            required: ['audio'],
          }),
          '400': resp('Validation error, not an MP3 file or folder full'),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/audio/{audioId}': {
      get: {
        tags: ['Photos'],
        summary: 'Get a recording',
        description:
          'Streams the stored MP3. Supports single `Range` requests so players can seek. Pass `download=1` to get it as an attachment.',
        security: sessionOrToken(),
        parameters: [
          pathParam('id', 'Person ID'),
          pathParam('audioId', 'Recording ID'),
          {
            name: 'download',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['1'] },
            description: 'Send the file as a download instead of inline',
          },
        ],
        responses: {
          '200': {
            description: 'Audio file',
            content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
          },
          '206': {
            description: 'Requested byte range of the audio file',
            content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
          },
          '401': ref401(),
          '404': resp('Recording not found'),
          '416': resp('Requested range lies outside the file'),
        },
      },
      delete: {
        tags: ['Photos'],
        summary: "Delete a recording from a person's audio folder",
        description: 'Removes the recording and its file from disk.',
        security: sessionOrToken(),
        parameters: [pathParam('id', 'Person ID'), pathParam('audioId', 'Recording ID')],
        responses: {
          '200': refSuccess(),
          '401': ref401(),
          '404': ref404(),
        },
      },
    },
  };
}
