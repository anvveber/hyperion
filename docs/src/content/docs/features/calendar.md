---
title: Calendar
description: See every important date on a month calendar and download them as an .ics file for your calendar app.
sidebar:
  order: 7
---

The Calendar page shows the [important dates](/features/important-dates/) of everyone in your network on a month grid: birthdays, anniversaries, name days, memorials and your own custom dates. Open it from **Calendar** in the main navigation.

## Browsing months

The page opens on the current month, with today highlighted. Use the arrows to move between months, and **Today** to jump back. On a wide screen each day lists the names of the people who have a date that day; on a phone each day shows how many dates fall on it.

Below the grid, a list shows every date in the month with the person's name, what the date is, and how many years it has been for yearly dates with a known year (for example "34 years" on a birthday). Click a name to open that person.

## Downloading an .ics file

**Download .ics** saves a file called `important-dates.ics` with all your important dates. Import it into Google Calendar, Apple Calendar, Outlook, Thunderbird or any other calendar app that reads iCalendar files.

Each date becomes an all-day event called "Birthday: Anna Smith" (or the date's own title), marked as free time so it does not block your schedule. Events link back to the person's page in Nametag.

How dates repeat:

- **Birthdays, anniversaries, name days and memorials** repeat every year
- **Dates without a known year** repeat every year
- **Custom dates** follow their reminder: a recurring reminder (for example every 6 months) sets how often the event repeats, a one-time reminder makes it a single event, and a date with no reminder repeats every year

The file is a snapshot. When you add or change dates in Nametag, download it again and import it over the old one: every event keeps the same identifier between downloads, so calendar apps that honour it update the existing events instead of adding duplicates. Dates you deleted in Nametag are not removed from your calendar automatically; delete them there by hand.

## Technical details

- Events are all-day `VEVENT`s with `DTSTART;VALUE=DATE` and a `DTEND` on the next day, and `TRANSP:TRANSPARENT`
- Recurring dates carry an `RRULE` (`FREQ=YEARLY`, `MONTHLY`, `WEEKLY` or `DAILY`, with `INTERVAL` when it is more than 1)
- A yearly February 29 uses `BYMONTH=2;BYMONTHDAY=-1`, so it shows on February 28 in common years
- Dates without a known year start in the year 2000, because some calendar apps do not expand events that start centuries ago
- Event UIDs have the form `important-date-<id>@nametag` and do not change between downloads
- Event titles and the calendar name use your language setting
- Deleted people and deleted dates are left out
