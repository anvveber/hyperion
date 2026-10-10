import { adminCreateUserSchema, adminUpdateUserSchema } from '../validations';
import { zodBody, jsonResponse, ref400, ref401, ref404, refSuccess, pathParam, resp, sessionOnly } from './helpers';

const adminUserObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    surname: { type: ['string', 'null'] },
    role: { type: 'string', enum: ['ADMIN', 'USER'] },
    provider: {
      type: ['string', 'null'],
      description: 'SSO provider linked to the account, if any',
    },
    hasPassword: { type: 'boolean', description: 'Whether the account can log in with a password' },
    createdAt: { type: 'string', format: 'date-time' },
    lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
  },
};

const ref403 = () => resp('Admin access required');

export function adminPaths(): Record<string, Record<string, unknown>> {
  return {
    '/api/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List all accounts',
        description: 'Lists every account on the instance, oldest first. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        responses: {
          '200': jsonResponse('Accounts', {
            type: 'object',
            properties: {
              users: { type: 'array', items: adminUserObject },
            },
          }),
          '401': ref401(),
          '403': ref403(),
        },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create an account',
        description:
          'Creates an account. The password is required unless OIDC is configured, in which case it may be omitted ' +
          'and the person signs in with SSO using this email. A password is rejected when password login is disabled. ' +
          'Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        requestBody: zodBody(adminCreateUserSchema),
        responses: {
          '201': jsonResponse('Created account', {
            type: 'object',
            properties: { user: adminUserObject },
          }),
          '400': ref400(),
          '401': ref401(),
          '403': ref403(),
        },
      },
    },
    '/api/admin/users/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Change role or reset password',
        description:
          'Changes an account\'s role, sets a new password, or both. Setting a password also clears any login lockout. ' +
          'The last admin cannot be demoted. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'User ID')],
        requestBody: zodBody(adminUpdateUserSchema),
        responses: {
          '200': refSuccess(),
          '400': ref400(),
          '401': ref401(),
          '403': ref403(),
          '404': ref404(),
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Delete an account',
        description:
          'Permanently deletes another account and all of its data. Admins delete their own account through ' +
          '/api/user/delete instead. Admins only. Session (cookie) auth only.',
        security: sessionOnly(),
        parameters: [pathParam('id', 'User ID')],
        responses: {
          '200': refSuccess(),
          '400': ref400(),
          '401': ref401(),
          '403': ref403(),
          '404': ref404(),
        },
      },
    },
  };
}
