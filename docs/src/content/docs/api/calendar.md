---
title: Calendar
description: API endpoint for downloading important dates as an iCalendar (.ics) file.
sidebar:
  order: 7
---

## Download important dates as iCalendar

```
GET /api/calendar/ics
```

Returns every important date of your people as an iCalendar file (`text/calendar`), served as the attachment `important-dates.ics`. Each date is an all-day event; recurring dates carry an `RRULE`. See [Calendar](/features/calendar/) for how dates map to events and how they repeat.

```bash
curl https://your-instance.example.com/api/calendar/ics \
  -H "Authorization: Bearer ntag_xxx" \
  -o important-dates.ics
```

Accepts a session cookie or an API token (read-only tokens work). Returns `401` without either.
