---
title: Family
description: Family location sharing. Last positions from an OwnTracks Recorder, and who shares them.
sidebar:
  order: 15
---

These endpoints back the **Family** page, the **Location** panel on profiles, and **Settings > Family**. They need `LOCATION_RECORDER_URL` to be set (see [Family locations](/features/family-locations/)) and a browser session: API tokens are refused.

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
  "recorderReachable": true,
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

When the feature is off, `enabled` is false. When the viewer doesn't share, `canView` is false and `members` is empty. Add `?summary=1` to get only `enabled` and `canView` without contacting the Recorder.

## A person's location

```
GET /api/people/{id}/location
PUT /api/people/{id}/location
```

`GET` returns the family member the person is linked to (`member`, or null), their `position`, `recorderReachable`, and `options`: the members the person can be linked to.

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
```

These never return positions. `GET` returns `members` and `users` (all accounts, for linking). `POST` takes:

```json
{ "name": "Mum", "recorderUser": "mum", "recorderDevice": "phone", "userId": null }
```

`recorderUser` and `recorderDevice` must match what the phone reports to the Recorder. They are lowercased and may contain letters, digits, `.`, `_` and `-`. `PATCH` takes any of the same fields. A Recorder user and device pair, or an account, that already belongs to a member is rejected with `400`. Deleting a member unlinks the people linked to them.
