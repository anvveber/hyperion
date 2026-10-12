---
title: Family
description: Family location sharing. Last positions sent by the family's phones, and who shares them.
sidebar:
  order: 15
---

These endpoints back the **Family** page, the **Location** panel on profiles, and **Settings > Family**. They need `LOCATION_PORT` to be set (see [Family locations](/features/family-locations/)) and a browser session: API tokens are refused.

Access is mutual. Positions are only returned to accounts linked to a family member, that is, accounts that share their own location.

## Family positions

```
GET /api/family
```

```json
{
  "enabled": true,
  "canView": true,
  "isAdmin": false,
  "members": [
    {
      "id": "clx...",
      "name": "Mum",
      "isMe": false,
      "position": { "lat": 41.9, "lon": 12.49, "tst": 1760270000, "acc": 12, "batt": 80 }
    }
  ]
}
```

`tst` is when the phone took the fix, in seconds since the epoch. `acc` (metres) and `batt` (percent) are null when the phone didn't send them. `position` is null when the member has not sent one yet.

When the feature is off, `enabled` is false. When the viewer doesn't share, `canView` is false and `members` is empty. Add `?summary=1` to get only `enabled` and `canView`.

## A person's location

```
GET /api/people/{id}/location
PUT /api/people/{id}/location
```

`GET` returns the family member the person is linked to (`member`, or null), their `position`, and `options`: the members the person can be linked to.

`PUT` links or unlinks:

```json
{ "familyMemberId": "clx..." }
```

Send `null` to unlink. Returns `403` when the viewer doesn't share their own location.

## Managing members (admins)

```
GET    /api/admin/family-members
POST   /api/admin/family-members
PATCH  /api/admin/family-members/{id}
DELETE /api/admin/family-members/{id}
POST   /api/admin/family-members/{id}/password
```

These never return positions or password hashes. Each member has `hasPassword` and `lastSeenAt` (when the phone last sent a position). `GET` also returns `users` (all accounts, for linking) and `publicUrl`.

`POST` takes:

```json
{ "name": "Mum", "username": "mum", "userId": null }
```

The username is lowercased and may contain letters, digits, `.`, `_` and `-`. A username or an account that already belongs to a member is rejected with `400`. The response includes `setup`, with the generated phone password. It is returned only this once:

```json
{
  "member": { "id": "clx...", "name": "Mum", "username": "mum", "hasPassword": true, "lastSeenAt": null },
  "setup": {
    "username": "mum",
    "password": "k7mq-x2va-pd9r-hw4c",
    "url": "https://loc.example.org/pub",
    "link": "owntracks:///config?inline=..."
  }
}
```

`url` and `link` are null when `LOCATION_PUBLIC_URL` is not set. `link` opens the OwnTracks app and fills in its settings; the settings page shows it as a QR code.

`PATCH` takes any of `name`, `username` and `userId`. `POST .../password` generates a new phone password, returned the same way in `setup`; the old one stops working. Deleting a member removes their last position and unlinks the people linked to them.

## Location server

The phones don't use the endpoints above. They send to the location server, on its own port (`LOCATION_PORT`):

```
POST /pub
Authorization: Basic <username:password>
Content-Type: application/json

{ "_type": "location", "lat": 41.9, "lon": 12.49, "tst": 1760270000, "acc": 12, "batt": 80 }
```

This is the OwnTracks HTTP format. The reply is `[]`. Other `_type` values are accepted and ignored. Wrong credentials get `401`, too many failures for a username `429`, an unusable position `400`, and a body over 16 KB `413`. `GET /health` answers `{"status":"ok"}`; any other path is `404`.
