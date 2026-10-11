---
title: Documents
description: Keep photos, PDFs, videos and any other file with a person.
sidebar:
  order: 9
---

Every person has a document folder for files you want to keep with them: photos from a trip, a scanned contract, a video, a screenshot of a note they wrote you. Any file type is accepted. The folder replaces the older image folder; images that were already there are kept.

On a person's detail page, the **Documents** section shows the folder as a grid, newest first. Images show a thumbnail. Other files show an icon with their type (PDF, DOCX, MP4...) and their name.

- **Add files**: click **Add files** and pick one or more files. They upload one after another. HEIC photos from iPhones are converted to JPEG first, because browsers cannot show HEIC.
- **View**: click a file to open it. Images are shown full-size, PDFs and plain text open in the browser's viewer, and videos and audio play in place. Files the browser cannot show (Word documents, archives, web pages) get a **Download** button instead. Use the arrow buttons or the left and right arrow keys to move through the folder, and Escape to close.
- **Open or download**: the buttons at the top right open the file in a new tab or save it to your device.
- **Delete**: open a file and click the trash button. You are asked to confirm.

## Duplicates are stored once

Files are stored by their content (a SHA-256 hash), not by name. If you add a file that this person already has, nothing is added and you are told it was already in the folder. If you add the same file to two people, both folders show it but the disk keeps a single copy. The copy is deleted only when the last folder using it lets go of it, including folders of people in the trash.

When a person is permanently deleted (emptied from the trash), their document entries go too, along with any file nobody else uses.

## Technical details

| Spec | Value |
| --- | --- |
| Max upload size | 200 MB per file |
| Max files per person | 1000 |
| Accepted types | Any. The type is detected from the file content; the type the browser reports is only used for formats Nametag does not recognise. |
| Stored as | The file exactly as uploaded (no resizing or re-encoding, EXIF data kept) |
| Thumbnails | 400x400px square crop, for JPEG, PNG, GIF, WebP and AVIF |
| Shown in the browser | JPEG, PNG, GIF, WebP, AVIF, PDF, MP4, WebM, QuickTime, MP3, M4A, Ogg, WAV, FLAC, plain text. Everything else is downloaded. Whether a given video plays depends on the browser's codecs. |
| Storage location | `{PHOTO_STORAGE_PATH}/{userId}/documents/{first two characters of hash}/{sha256}`, thumbnail next to it as `{sha256}.thumb` |
| Deduplication | Per account. Two accounts uploading the same file each keep their own copy. |
| JSON export | Lists each file's name, type, size, hash and date added. The files themselves are not in the JSON; back up the storage folder for those. |

### Upgrading from the image folder

The database migration turns every image folder entry into a document. On the next start the app moves the files from `{PHOTO_STORAGE_PATH}/{userId}/gallery/{personId}/` into the hashed store, checks each copy, and only then deletes the old file. Until a file has been moved it is served from its old place, so nothing goes missing in between. Old images get names like `image_20261010_193000.jpg` from the date they were added, since the original file names were never saved.

### Reverse proxies

Uploads up to 200 MB pass through Nametag itself. A reverse proxy in front of it (nginx, Traefik, Pangolin, Cloudflare) often has its own, smaller body size limit, and larger uploads then fail before they reach Nametag. Raise the proxy's limit if you want to store big videos (for nginx, `client_max_body_size 200m;`).
