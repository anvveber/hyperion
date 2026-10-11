---
title: People
description: How to add, edit, and manage contacts in Nametag.
sidebar:
  order: 1
---

People are the heart of Nametag. Everything else, groups, relationships, the network graph, exists to help you understand and stay close to the people you add here.

## Creating a contact

The only required field is a full name. Everything else is optional, so you can jot down a name in a few seconds and come back to fill in the rest whenever you have time (or never, if you don't need to).

### Name fields

Nametag's name handling is flexible enough for real-world naming conventions, not just "first name, last name":

- **Name**: first name (required)
- **Surname**: last name
- **Middle name**
- **Second last name**: for Spanish naming customs, where a person carries both a paternal and maternal surname
- **Prefix / suffix**: honorifics like Dr. or Jr.
- **Nickname**: what you actually call them
- **Display name override**: forces a specific string to be shown everywhere in the app instead of the name built from the fields above

### Other names

People often go by more than one name. The **Other names** section holds as many extra names as you need, each tagged with a type:

- **Nickname**: extra nicknames beyond the main one
- **Former name**: a maiden name or a name someone used before
- **Other alphabet**: the same name written in another script, like "Лена Иванова" or "李小龍"
- **Other**, or any label you type

Each entry can also note the language or alphabet. Other names show on the person page and are matched by both the quick search and the Name field of [advanced search](/features/search/#advanced-search).

### Work info

Organization and job title, if you want to keep track of where someone works and what they do there.

## Multi-value contact fields

Phones, emails, addresses, URLs, and IM handles all support multiple entries per person, each tagged with a type:

- **Phones**: Mobile, Home, Work, Fax, Other
- **Emails**: Personal, Work, Other
- **Addresses**: Home, Work, Other. Each address is structured into street lines, city, state or region, postal code, and country, so it can be geocoded and shown on the Map
- **Websites**: Personal, Work, Other
- **Messaging handles**: tagged by platform (Discord, Telegram, Signal, WhatsApp, Skype, Other, or any platform name you type)

Add as many of each as you need, including several handles on the same platform. There's no limit on how many phone numbers or emails a single person can have.

### Platform user IDs

Usernames change, but most platforms also give each account a permanent numeric ID. Next to each handle you can store that **user ID** as well. For Discord, turn on Developer Mode in Discord's settings, then right-click the person and choose **Copy User ID**. On the person page, a Discord user ID links to the person's Discord profile. When the username later changes, edit the handle and keep the ID: the old username is kept in the field history together with the ID.

User IDs are not part of vCards, so they are not sent to CardDAV servers. A sync from the server keeps the stored ID as long as the handle itself is unchanged.

## Field history

When you change or remove a name, nickname, organization, job title, phone number, email, address, website or handle, Nametag keeps the old value instead of throwing it away. Each kept value has a **valid from** and **valid to** date:

- **Valid to** is the day the value was changed or removed
- **Valid from** is when that value was first saved in Nametag, if known. Values that existed before field history was added start from the date they were last saved, so check those dates and correct them if needed

On the person page, a **View previous ...** link appears under any field that has older values (for example "View previous phone numbers"). Open it to see the old values with their dates. From there you can:

- **Edit** a value or its dates, for example to set the real date someone moved
- **Delete** a value you don't want to keep. This cannot be undone

Use **Add a previous value** in the **Previous values** panel to record an old value by hand, like an address from before you started using Nametag.

Changing only the type of a value (Mobile to Work, for example) or its formatting (`+49 170 1112223` to `+491701112223`) does not create a history entry. Changes that arrive through [CardDAV sync](/features/carddav/) are recorded the same way as edits made in Nametag.

Previous values are included in the [JSON export](/features/import-export/) and can be found with [advanced search](/features/search/#advanced-search) when you tick **Also match previous values**.

## Important dates

Birthdays, anniversaries, and any custom date worth remembering (a first meeting, a memorial, whatever matters to you) live on the person record. See [Important Dates](/features/important-dates/) for reminders and recurrence options.

## Notes

Notes support markdown with a live preview, so you can format lists, links, and emphasis while writing down context about a person: how you met, what they care about, things to remember for next time.

## Last contact

Nametag tracks the date you last spoke with or saw someone. On the person detail page, a quick-update button lets you mark "contacted today" in a single click, without opening the edit form.

## Photos

Every person can have a photo, uploaded and cropped directly in the app. See [Photos](/features/photos/) for details on formats and cropping.

## Custom field values

If you've defined custom field templates in Settings (text, number, boolean, or select fields), each person's edit page shows an input for every template so you can fill in values specific to your own workflow. See [Custom Fields](/features/custom-fields/) for how to define templates.

## The people list

The People page shows everyone in your network, 50 per page.

**The layout adapts to your screen width.** On wide screens the list is a table that breaks names into separate Name, Surname and Nickname columns, so each one can be sorted on its own. On phones each person is a card instead, with the full name (long names wrap onto a second line), the relationship and group badges, and the last contact date. A row above the cards selects everyone on the page and sorts by full name, relationship, group or last contact. Cards follow your [name order and name display format](/features/settings/) settings, so a Short name display format shows only the nickname or first name there too.

**Sorting** is available by:

- Name
- Surname
- Nickname
- Relationship (your relationship to the person)
- Group
- Last contact

**Filtering** narrows the list down by:

- Group (including an option to show only people who don't belong to any group)
- Relationship type (including an option to show only people with no set relationship to you)
- Custom field value, using a URL parameter in the form `?cf=slug:value`

## Bulk actions

Select multiple people from the list to delete them, assign them to a group, or assign a relationship type all at once. See [Bulk Actions](/features/bulk-actions/) for the full workflow.

## Unsaved changes protection

When editing a person, Nametag warns you before navigating away if you have unsaved changes. This applies to the browser back button, the "Back to person" link, the Cancel button, page refresh, and closing the tab. If nothing has changed, navigation proceeds without a prompt.

## The person detail page

The detail page for a person brings every section together in one place: name and photo, work info, contact information, addresses, important dates, notes, custom field values, group memberships, your relationship to them, their relationships to other people, and a journal timeline of entries linked to them. It's designed to give you the full picture of a person at a glance, with editing just one click away.

## Field limits

| Field | Limit |
| --- | --- |
| Name (first name) | 1-100 characters |
| Surname, middle name, second last name, nickname | up to 100 characters each |
| Prefix, suffix | up to 50 characters each |
| Display name override | up to 200 characters |
| Organization, job title | up to 200 characters each |
| Notes | up to 10,000 characters (markdown supported) |
| Phone number | 1-50 characters |
| Phone/email/address/URL type labels | 1-50 characters |
| Street address (per line) | up to 200 characters |
| City, region, country | up to 100 characters each |
| Postal code | up to 20 characters |
| URL | 1-500 characters |
| IM handle | 1-200 characters |
| IM platform name | 1-50 characters |
| Platform user ID | up to 100 characters |
| Other name | 1-200 characters, up to 100 other names per person |
| Other name language or alphabet | up to 100 characters |
| Previous value (field history) | 1-500 characters |
| Pagination | 50 contacts per page |

**Type options:**

- **Phone types**: Mobile, Home, Work, Fax, Other
- **Email types**: Personal, Work, Other
- **Address types**: Home, Work, Other
- **URL types**: Personal, Work, Other
- **IM platforms**: Discord, Telegram, Signal, WhatsApp, Skype, Other, or any name you type
- **Other name types**: Nickname, Former name, Other alphabet, Other, or any label you type
