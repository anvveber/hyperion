---
title: Import & Export
description: Move your data in and out of Nametag.
sidebar:
  order: 12
---

Your data is always yours. Nametag supports exporting and importing your contacts in two formats: a complete JSON backup, and the standard vCard format used by most contacts apps.

## JSON export

Go to **Settings > Account > Export Data**. This exports a complete snapshot of your data as a single JSON file, including:

- All people, with every sub-field: contact details, addresses, messaging handles with their platform user IDs, other names, previous values from the field history, location history, custom fields, important dates, and more
- The list of files in each person's document folder (name, type, size, hash and date). The files themselves are not included; back up the storage folder for those (see [Backups](/self-hosting/backups/))
- Groups
- Relationship types
- Journal entries
- Custom field templates

You can optionally filter the export to only include people in specific groups, useful if you want a partial backup or want to share a subset of your network.

Use JSON export for backups and for moving your data between Nametag instances.

## JSON import

Go to **Settings > Account > Import Data** and upload a previously exported JSON file. Before anything is imported, Nametag shows a validation preview with counts of what will be brought in (people, groups, and so on), and the server validates the file's structure to make sure it's a well-formed Nametag export.

You can choose which groups to import. Only people who belong to at least one selected group are imported, along with the relationships between them.

## vCard import

Also from **Settings > Account > Import Data**, you can upload a `.vcf` file containing one or more contacts. Nametag maps standard vCard fields to its own: `FN`, `N`, `TEL`, `EMAIL`, `ADR`, `BDAY`, `ORG`, `TITLE`, `NOTE`, and others. Multi-contact vCard files are supported, up to 2MB per file.

This is the easiest way to bring contacts in from another app that can export vCards, without needing a Nametag-specific export first.

## vCard export

You can export contacts as standard vCard 4.0 files from a person's detail page, or in bulk for many contacts at once. Photos are included by URL reference. The resulting file works with any app that reads vCards, not just Nametag.

## Single person JSON export

On a person's detail page, open the actions menu (the three dots) and pick **Download profile as JSON**. The file holds everything about that one person: all fields, contact details, important dates, location history, groups, relationships with their notes, and journal entries that mention them. The person's document and recording lists are included, with the transcripts of recordings added from the recordings library, but photo, document and audio files themselves are not.

## Single person PDF

On a person's detail page, open the actions menu (the three dots) and pick **Download profile as PDF**. You get an A4 file laid out like a record card, in your language and date format:

- name, photo, groups, and a line with the record ID and the dates the record was created and last updated
- personal details, other names, work info, contact information and online presence, each with their previous values struck through and dated
- important dates, custom fields, location history and notes
- relationships, and every journal entry that mentions the person
- the names of attached documents and recordings, and up to 24 attached images

Every page carries the person's name and a page number at the bottom.

When some of the person's recordings came from the recordings library with a transcript, the menu also offers **Download profile as PDF with transcripts**, which appends each transcript, one line per segment with its time.

### Technical details

- Fonts are IBM Plex Sans and Mono, bundled with the app. They cover Latin, Cyrillic and Greek.
- Chinese, Japanese and Korean text uses Noto Sans CJK, which the Docker image installs. Outside Docker, install Noto Sans CJK or point `PDF_CJK_FONT` at another CJK font (see [Configuration](/self-hosting/configuration/)). Without one, those characters show as empty boxes.
- Notes and journal entries are Markdown in the app; the PDF shows them as plain paragraphs, with list items as bullets and links followed by their address.
- Images come from their thumbnails, so a large gallery stays a reasonable file size. Images past the first 24 are counted but not shown.

## Data portability

Export everything as JSON to back up or move to another Nametag instance. Export as vCard to take your contacts anywhere that speaks the format. Either way, your data never gets stuck.

## Size limits

| Import/export type | Limit |
| --- | --- |
| JSON import | 5 MB max |
| vCard import (text paste) | 2 MB max |
| vCard import (file upload) | 2 MB max |
| JSON export | no size limit, generates a full dump |
| PDF export | one person, up to 24 images |
