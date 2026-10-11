---
title: Location history
description: Log the places a person went, when they went and why.
sidebar:
  order: 20
---

Location history is a log of places a person went. Each entry is a visit with a date, a location and a motivation (the reason they went). It is separate from their addresses: an address is where someone lives or works, a visit is somewhere they went.

For example, on John Doe's page you could log "12 March 2025, Lisbon, attending his sister's wedding".

## Logging a visit

On a person's detail page, find the **Location history** section and click **Log a visit**. Fill in:

- **Date**: the day they went. Leave it empty if you don't know it.
- **Location**: where they went, written however you like ("Lisbon", "Grandma's farm", "Hotel Adlon, Berlin").
- **Motivation**: why they went. Optional, and can be several lines.

Click **Add** to save it.

## Editing and deleting

Each visit has **Edit** and **Delete** buttons. Delete asks for confirmation and cannot be undone.

Visits are listed newest first. Visits without a date are listed last.

## Export, import and merging

Location history is included in the JSON export (account export and single-person export) and restored by JSON import. When you merge two duplicate people, the visits of both are kept on the merged person. Location history is not synced to CardDAV, since vCards have no field for it.

## Technical details

| Spec | Value |
| --- | --- |
| Location | Required, free text, up to 200 characters |
| Motivation | Optional, up to 2000 characters |
| Date | Optional calendar date (`YYYY-MM-DD`) |
| Sort order | Date, newest first; undated visits last |
| API | [`/api/people/{id}/visits`](/api/people/#location-history) |
