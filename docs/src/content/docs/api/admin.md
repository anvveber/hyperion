---
title: Admin
description: Create, change and delete accounts on the instance. Admins only.
sidebar:
  order: 14
---

These endpoints back **Settings > Users**. They require an admin account and a browser session: API tokens are refused, so a leaked token can't create or delete accounts. A non-admin gets `403`.

## List accounts

```
GET /api/admin/users
```

Returns every account, oldest first. Password hashes are never returned; `hasPassword` says whether the account can log in with a password.

```json
{
  "users": [
    {
      "id": "clx...",
      "email": "me@example.com",
      "name": "Ana",
      "surname": null,
      "role": "ADMIN",
      "provider": null,
      "hasPassword": true,
      "createdAt": "2026-10-10T12:00:00.000Z",
      "lastLoginAt": "2026-10-10T12:05:00.000Z"
    }
  ]
}
```

## Create an account

```
POST /api/admin/users
```

| Field | Type | Notes |
| --- | --- | --- |
| `email` | string | Required. Stored lowercase. Must not already exist. |
| `name` | string | Required, 1 to 100 characters. |
| `surname` | string | Optional, up to 100 characters. |
| `password` | string | Required unless OIDC is configured. Same rules as signup. Rejected when password login is disabled. |
| `role` | string | `USER` (default) or `ADMIN`. |

Returns `201` with `{ "user": { ... } }` in the same shape as the list.

## Change role or reset password

```
PATCH /api/admin/users/{id}
```

| Field | Type | Notes |
| --- | --- | --- |
| `role` | string | `USER` or `ADMIN`. Demoting the last admin returns `400`. |
| `password` | string | New password. Also clears any login lockout. |

At least one field is required. Returns `{ "success": true }`.

## Delete an account

```
DELETE /api/admin/users/{id}
```

Permanently deletes the account and all of its data, including its photos, documents and audio files on disk. An admin can't delete their own account here; that goes through [`DELETE /api/user/delete`](/api/user/#account-deletion). Returns `{ "success": true }`.

## Technical details

- The first account created on an empty instance (by signup or a first SSO login) is the admin. Self-hosted instances accept no other public signups.
- The instance always keeps at least one admin.
- Accounts created by an admin are marked as verified, so no verification email is sent.
