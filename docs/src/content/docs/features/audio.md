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

## Adding from your recordings library

If your server keeps an archive of voice recordings, with transcripts made by whisper.cpp, Nametag can read it and you can add recordings to a person straight from it, transcript included. An admin sets this up once (see [Setting up the library](#setting-up-the-library)); after that, admins see a **From library** button next to **Add recordings**.

The picker shows the months that hold recordings, newest first. Pick a month to see its recordings with their date, length and the first words of the transcript. With a search index, you can also search every transcript:

| You type | You get |
| --- | --- |
| `notaio contratto` | recordings with both words, anywhere in them |
| `notaio OR stampante` | either word |
| `contratto NOT firenze` | has "contratto" but no "firenze" anywhere |
| `"esame di diritto"` | the exact phrase |
| `stamp*` | words starting with "stamp" |

Operators are written in capitals. Accents are ignored, so `perche` finds "perché". Search results show the matching words highlighted.

The play button previews a recording before you add it. Tick the ones you want (up to 20 at a time) and click **Add**. Each one is copied into the person's audio folder with its transcript; recordings already in the folder are skipped. The original stays in the library untouched.

## Transcripts

Recordings added from the library show a **Transcript** button. It opens the transcript as one line per segment, each with its time. Click a time to play from there; while a recording plays, the current line is marked.

The transcript is a copy taken when you added the recording. When the archive has a search index, Nametag copies the index's segments, which leave out the lines the indexer filters (silence hallucinations, repeated lines). Otherwise it copies the segments from the whisper.cpp JSON as they are.

Transcripts are included in the JSON exports, and **Download profile as PDF with transcripts** in the person menu appends them to the PDF.

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

### Setting up the library

The library is read only and shared by the whole instance, so only admins can see or use it. It expects this layout, which is what the voice pipeline writes:

```
{library}/archive/YYYY/MM/yymmdd_hhmm.mp3     recordings (continuation files like yymmdd_hhmm_01.mp3 work too)
{library}/text/YYYY/MM/yymmdd_hhmm.json        whisper.cpp JSON (whisper-cli -oj)
{library}/index.db                             SQLite FTS5 index (optional, enables search)
```

Mount it into the container read only and point `RECORDINGS_LIBRARY_PATH` at it:

```yaml
services:
  app:
    volumes:
      - photo_data:/app/data/photos
      - /vault/voice:/recordings:ro
```

```bash
RECORDINGS_LIBRARY_PATH=/recordings
```

`RECORDINGS_ARCHIVE_DIR`, `RECORDINGS_TEXT_DIR` and `RECORDINGS_INDEX_DB` move the three parts if your layout differs (see [Configuration](/self-hosting/configuration/)).

The index is read with Node's built-in SQLite. It needs the tables `recordings (id, path, recorded_at, duration_ms, language, ...)`, `docs` (FTS5: `text`, `rec_id`) and `segments` (FTS5: `text`, `rec_id`, `start_ms`, `end_ms`), with `path` relative to the archive. Without an index, browsing and transcripts still work and search is hidden.

| Spec | Value |
| --- | --- |
| Recordings per request | up to 20 |
| Largest recording copied from the library | 2 GB |
| Search results | up to 50, newest first |
| Access | admins only, session login only (API tokens are refused) |

Audio files live in the same storage volume as photos, so the photo backup steps in [Backups](/self-hosting/backups/) cover them too. If you run Nametag behind a reverse proxy, make sure its request body limit allows uploads of the size you need.
