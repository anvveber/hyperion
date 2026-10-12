import { familyMemberSchema, familyMemberUpdateSchema, personFamilyMemberSchema } from '../validations';
import { zodBody, jsonResponse, ref400, ref401, ref404, refSuccess, pathParam, resp, sessionOnly } from './helpers';

const ref403Admin = () => resp('Admin access required');

const position = {
  type: ['object', 'null'],
  description: 'Last position the phone sent to the OwnTracks Recorder, or null when there is none',
  properties: {
    lat: { type: 'number' },
    lon: { type: 'number' },
    tst: { type: 'integer', description: 'Time the phone took the fix, seconds since the epoch' },
    acc: { type: ['number', 'null'], description: 'Accuracy in metres' },
    batt: { type: ['number', 'null'], description: 'Battery level in percent' },
  },
  required: ['lat', 'lon', 'tst', 'acc', 'batt'],
};

const adminMember = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    recorderUser: { type: 'string', description: 'User name the phone reports to the Recorder (lowercase)' },
    recorderDevice: { type: 'string', description: 'Device name the phone reports to the Recorder (lowercase)' },
    userId: { type: ['string', 'null'], description: 'Account that shares as this member' },
    user: {
      type: ['object', 'null'],
      properties: { email: { type: 'string' }, name: { type: 'string' }, surname: { type: ['string', 'null'] } },
    },
  },
  required: ['id', 'name', 'recorderUser', 'recorderDevice', 'userId', 'user'],
};

const sharingDescription =
  'Family location sharing reads the last known positions from an OwnTracks Recorder configured with ' +
  'LOCATION_RECORDER_URL. hyperion stores no positions. Access is mutual: only accounts linked to a family ' +
  'member (that is, accounts that share their own location) can see positions. Session (cookie) auth only.';

export function familyPaths(): Record<string, Record<string, unknown>> {
  return {
    '/api/family': {
      get: {
        tags: ['Family'],
        summary: 'Family members and their last positions',
        description: `${sharingDescription} With summary=1 the Recorder is not contacted and members is empty; the navigation uses this to decide whether to show the Family tab.`,
        security: sessionOnly(),
        parameters: [
          { name: 'summary', in: 'query', required: false, schema: { type: 'string', enum: ['1'] }, description: 'Only report whether the viewer can see the family page' },
        ],
        responses: {
          '200': jsonResponse('Family positions', {
            type: 'object',
            properties: {
              enabled: { type: 'boolean', description: 'False when LOCATION_RECORDER_URL is not set' },
              canView: { type: 'boolean', description: 'True when the viewer shares their own location' },
              isAdmin: { type: 'boolean' },
              recorderReachable: { type: 'boolean' },
              members: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    isMe: { type: 'boolean' },
                    position,
                  },
                  required: ['id', 'name', 'isMe', 'position'],
                },
              },
            },
            required: ['enabled', 'canView', 'isAdmin', 'recorderReachable', 'members'],
          }),
          '401': ref401(),
        },
      },
    },
    '/api/admin/family-members': {
      get: {
        tags: ['Family'],
        summary: 'List family members (admin)',
        description: 'Lists everyone set up for location sharing, and all accounts for linking. Returns no positions. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        responses: {
          '200': jsonResponse('Family members and accounts', {
            type: 'object',
            properties: {
              members: { type: 'array', items: adminMember },
              users: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, surname: { type: ['string', 'null'] } },
                },
              },
            },
          }),
          '401': ref401(),
          '403': ref403Admin(),
        },
      },
      post: {
        tags: ['Family'],
        summary: 'Add a family member (admin)',
        description:
          'Adds someone who shares their location. recorderUser and recorderDevice must match what their phone reports to the Recorder; ' +
          'they are lowercased. Each Recorder user and device pair, and each account, can belong to one member only. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        requestBody: zodBody(familyMemberSchema),
        responses: {
          '201': jsonResponse('Created member', { type: 'object', properties: { member: adminMember } }),
          '400': ref400(),
          '401': ref401(),
          '403': ref403Admin(),
        },
      },
    },
    '/api/admin/family-members/{id}': {
      patch: {
        tags: ['Family'],
        summary: 'Update a family member (admin)',
        description: 'Changes the name, Recorder identity or linked account of a family member. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'Family member ID')],
        requestBody: zodBody(familyMemberUpdateSchema),
        responses: {
          '200': jsonResponse('Updated member', { type: 'object', properties: { member: adminMember } }),
          '400': ref400(),
          '401': ref401(),
          '403': ref403Admin(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['Family'],
        summary: 'Remove a family member (admin)',
        description: 'Removes a family member. People linked to them are unlinked. Positions on the Recorder are not touched. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'Family member ID')],
        responses: {
          '200': refSuccess(),
          '401': ref401(),
          '403': ref403Admin(),
          '404': ref404(),
        },
      },
    },
    '/api/people/{id}/location': {
      get: {
        tags: ['Family'],
        summary: 'Shared location of a person',
        description: `${sharingDescription} Returns the family member this person is linked to and their last position, plus the members the person could be linked to.`,
        security: sessionOnly(),
        parameters: [pathParam('id', 'Person ID')],
        responses: {
          '200': jsonResponse('Person location', {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              canView: { type: 'boolean' },
              member: {
                type: ['object', 'null'],
                properties: { id: { type: 'string' }, name: { type: 'string' } },
              },
              position,
              recorderReachable: { type: 'boolean' },
              options: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
              },
            },
            required: ['enabled', 'canView', 'member', 'position', 'options'],
          }),
          '401': ref401(),
          '404': ref404(),
        },
      },
      put: {
        tags: ['Family'],
        summary: 'Link a person to a family member',
        description: 'Links this person to a family member so their profile shows that member\'s shared position, or unlinks with null. Only accounts that share their own location can do this. Session (cookie) auth only.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'Person ID')],
        requestBody: zodBody(personFamilyMemberSchema),
        responses: {
          '200': refSuccess(),
          '400': ref400(),
          '401': ref401(),
          '403': resp('The viewer does not share their own location'),
          '404': ref404(),
        },
      },
    },
  };
}
