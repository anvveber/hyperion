---
title: Family locations
description: Family members who choose to share see each other's last position, on a map and on their profiles.
sidebar:
  order: 21
---

Family locations shows where the people in your family last were, for those who choose to share. It is meant for a few people who look out for each other: parents, a grandparent who sometimes doesn't answer the phone.

It is built around a few rules:

- **Opt-in and visible.** Each person installs the location app on their own phone and can see that it is running. They can stop sharing at any time by turning it off.
- **Mutual.** Only accounts that share their own location can see anyone's. An admin who doesn't share sees no positions, even though they manage the list.
- **Last position only.** hyperion shows the most recent position of each phone and stores none of it. With the setup below, the server keeps no movement history either.

## How it works

The phones run the [OwnTracks](https://owntracks.org/) app (Android and iOS), which sends the phone's position to an **OwnTracks Recorder** running on your server. hyperion asks the Recorder for the last known positions when a page needs them. The Recorder has no login of its own, so a small proxy sits in front of it and only lets each phone, with its own password, send positions.

```
phone (OwnTracks) --HTTPS--> your reverse proxy --> recorder-proxy (Caddy, /pub only) --> recorder
                                                                                              ^
                                                               hyperion (internal network) ---+
```

## The Family page

When location sharing is set up and your account shares, a **Family** tab appears in the navigation. It shows:

- A map with one marker per family member, with a faint circle for how accurate the position is.
- A list with the time of each person's last position, its accuracy and the phone's battery level.

Markers and times turn grey when a position is more than two hours old. The page refreshes every minute while it is open.

## On a person's profile

A person in your contacts can be linked to a family member. Their profile then shows a small map with that member's last position, when it was taken, and its accuracy. Use **Link** in the **Location** panel to choose the family member, and **Unlink** to remove it. The panel only appears for accounts that share.

## Managing family members

Admins manage the list in **Settings > Family**. Each family member has:

- **Name**: shown on the map.
- **Account**: the hyperion account that shares as this member. Linking an account is what lets it see the Family page. A member can also have no account (a grandparent who only shares and never opens hyperion).
- **Recorder user** and **Device**: the names their phone reports with. They must match what is set in the phone's OwnTracks app. They are not case-sensitive.

## Setting it up

### 1. Start the Recorder and the proxy

The repository has a compose file for both. Copy the proxy configuration, add one line per phone, and hash each password:

```bash
cp location/Caddyfile.example location/Caddyfile
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'a-long-password'
```

Edit `location/Caddyfile` so each line under `basic_auth` is a user name and its hash. Then start everything:

```bash
docker compose -f docker-compose.yml -f docker-compose.location.yml up -d
```

The Recorder runs with `--norec`, so it keeps only each phone's last position. It has no published port: only the app and the proxy can reach it.

### 2. Tell hyperion where the Recorder is

Add this to `.env` and restart the app:

```bash
LOCATION_RECORDER_URL=http://recorder:8083
```

### 3. Expose the proxy

Point a public HTTPS route (your reverse proxy, Pangolin, a Cloudflare Tunnel) at `recorder-proxy:8084`. Expose only the proxy, never the Recorder. Check it from outside:

- `https://your-route/pub` without a password answers `401`.
- `https://your-route/api/0/last` answers `404`.

### 4. Set up each phone

Install OwnTracks and set:

| Setting | Value |
|---------|-------|
| Mode | HTTP |
| URL | `https://your-route/pub` |
| User ID / Password | The user name and password from the Caddyfile |
| Device ID | A short name such as `phone` |

On iOS, choose the **Significant** monitoring mode: it uses very little battery and sends a position when the phone moves noticeably. On Android, the default mode is fine, and the app shows a notification while it runs.

### 5. Add the members

In **Settings > Family**, add each person with the same user and device names, and link their hyperion account if they have one. Each account that should see the map must be linked to a member, including your own.

## Technical details

- The proxy sets the Recorder user from the login (`X-Limit-U`), so a phone cannot report as someone else.
- A Recorder user and device pair, and an account, can each belong to one family member only.
- User and device names may contain letters, digits, `.`, `_` and `-`.
- Positions are read live from the Recorder's `/api/0/last` with a 5 second timeout. If the Recorder cannot be reached, the pages say so and show no positions.
- The Family endpoints accept browser sessions only, not API tokens.
- To check that no history is kept, run `docker compose exec recorder find /store/rec -name '*.rec'`. It should print nothing.
