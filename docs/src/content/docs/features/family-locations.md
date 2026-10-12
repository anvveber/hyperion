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
- **Last position only.** Each new position replaces the previous one. No movement history is kept.

## How it works

The phones run the [OwnTracks](https://owntracks.org/) app (Android and iOS) in HTTP mode. It sends the phone's position to hyperion's **location server**, a small server inside the hyperion container that listens on its own port (`LOCATION_PORT`). Each phone logs in with its own username and password.

Because it has its own port, the location server can have its own domain, such as `loc.example.org`, while hyperion itself stays behind your usual login. The location server answers only `POST /pub` (positions, with a password) and `GET /health`. Everything else is a 404, so nothing of hyperion can be reached through it.

```
phone (OwnTracks) --HTTPS--> loc.example.org --> hyperion container, port 3001 --> database (last position)
browser           --HTTPS--> hyperion.example.org --> hyperion container, port 3000
```

## The Family page

When location sharing is on and your account shares, a **Family** tab appears in the navigation. It shows:

- A map with one marker per family member, with a faint circle for how accurate the position is.
- A list with the time of each person's last position, its accuracy and the phone's battery level.

Markers and times turn grey when a position is more than two hours old. The page refreshes every minute while it is open.

## On a person's profile

A person in your contacts can be linked to a family member. Their profile then shows a small map with that member's last position, when it was taken, and its accuracy. Use **Link** in the **Location** panel to choose the family member, and **Unlink** to remove it. The panel only appears for accounts that share.

## Managing family members

Admins manage the list in **Settings > Family**. Each family member has:

- **Name**: shown on the map.
- **Phone username**: what their phone logs in with. Letters, digits, `.`, `_` and `-`, not case-sensitive.
- **Account**: the hyperion account that shares as this member. Linking an account is what lets it see the Family page. A member can also have no account (a grandparent who only shares and never opens hyperion).

When you add a member, hyperion generates their phone password and shows it **once**, with a QR code that sets up the phone. If it is lost, use **New phone password**: the old one stops working. The list shows when each phone last sent a position, so you can check that it works, but not where.

## Setting it up

### 1. Turn on the location server

Add to `.env`:

```bash
LOCATION_PORT=3001
LOCATION_PUBLIC_URL=https://loc.example.org
```

Publish the port in `docker-compose.yml`, under the `app` service:

```yaml
    ports:
      - 3000:3000
      - "3001:3001"
```

Then restart: `docker compose up -d`. The logs show `Listening for locations`.

### 2. Give it its own domain

Point a public HTTPS route at port 3001 of the hyperion container, the same way you route hyperion itself (your reverse proxy, Pangolin, a Cloudflare Tunnel). Use its own domain, for example `loc.example.org`.

Do not put a login page in front of this domain (an SSO or password page from your proxy): the phones can't get past it. The location server checks each phone's password itself.

Check it from outside:

- `https://loc.example.org/health` answers `{"status":"ok"}`.
- `https://loc.example.org/pub` without a password answers `401` to a POST, and anything else answers `404`.

### 3. Add the members and set up the phones

In **Settings > Family**, add each person. Right after you add them, the setup panel shows a QR code:

1. Install OwnTracks on their phone.
2. Scan the QR code with the phone's camera. It opens OwnTracks and fills in the settings.
3. Allow location access ("Always" on iOS, "Allow all the time" on Android).

If scanning doesn't work, enter the values shown next to the QR code in OwnTracks under the connection settings: mode **HTTP**, the URL, the username and the password.

On iOS, keep the **Significant** monitoring mode: it uses very little battery and sends a position when the phone moves noticeably. On Android, the app shows a notification while it runs.

Finally, link the hyperion accounts of the members who should see the map, including your own.

## Technical details

- Only the last position is stored, on the family member. Removing a member deletes it, with their phone login.
- A position older than the stored one is ignored (phones resend positions they couldn't send while offline).
- Phone passwords are generated, 16 characters from 31 letters and digits, and stored as scrypt hashes. After 10 failed logins for a username in 15 minutes, that username is refused for the rest of the window.
- Positions with a latitude or longitude out of range, or a time more than a day in the future, are rejected. Bodies over 16 KB are rejected.
- OwnTracks message types other than `location` (transitions, status) are accepted and ignored.
- The Family endpoints in the main API accept browser sessions only, not API tokens.
- In development, run `npm run dev:location` next to `npm run dev` (with `LOCATION_PORT` in `.env`).
