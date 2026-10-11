---
title: Audio recordings
description: Keep MP3 recordings with a person and play them back.
sidebar:
  order: 10
---

Every person has an audio folder for recordings you want to keep with them: voice messages, calls, a song they sang at your wedding.

## Adding recordings

On a person's detail page, the **Audio** section lists the folder. Click **Add recordings** and pick one or more `.mp3` files. They upload one after another.

Name your files `YYMMDD_HHMM.mp3` and Nametag reads the recording date and time from the name. For example, `241005_1430.mp3` is listed as 5 October 2024, 14:30. Anything after the minutes is ignored, so `241005_1430 call.mp3` works too. The time is shown exactly as written in the filename, with no timezone conversion.

Files with other names are still accepted. They are shown as having no date and listed after the dated ones.

## Listening and managing

- **Play**: click the play button next to a recording. A player opens under it, where you can pause and seek. Click the button again to close the player.
- **Download**: the download button saves the file under its original name.
- **Delete**: click the trash button. You are asked to confirm, and the file is removed from disk.

Recordings are sorted newest first by the date in their name. When a person is permanently deleted (emptied from the trash), their audio folder is deleted too.

## Technical details

| Spec | Value |
| --- | --- |
| Accepted format | MP3 only (checked from the file contents, not just the extension) |
| Max upload size | 200 MB per file |
| Max recordings per person | 1000 |
| Processing | None, the file is stored as uploaded |
| Filename date pattern | `YYMMDD_HHMM`, years read as 2000-2099 |
| Playback | Streamed with HTTP range support, so the player can seek without downloading the whole file |
| Storage location | `{PHOTO_STORAGE_PATH}/{userId}/audio/{personId}/`, files named `{audioId}.mp3` |

Audio files live in the same storage volume as photos, so the photo backup steps in [Backups](/self-hosting/backups/) cover them too. If you run Nametag behind a reverse proxy, make sure its request body limit allows uploads of the size you need.
