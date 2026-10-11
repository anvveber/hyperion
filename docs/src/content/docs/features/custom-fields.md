---
title: Custom Fields
description: Define custom attributes for your contacts.
sidebar:
  order: 10
---

Custom fields let you track attributes that aren't part of Nametag's built-in fields, whatever matters for how you think about your network: company, department, how you met, a membership number, or anything else specific to you.

## Defining a template

Custom fields start with a template, created in Settings > Custom Fields. Each template has:

- **Name**: what the field is called, shown as the label wherever it appears
- **Slug**: generated automatically from the name, used internally and in filter URLs
- **Type**: the kind of value the field holds

## Field types

Nametag supports eight field types:

- **Text**: free-form text
- **Number**: a numeric value
- **Yes / No**: a simple yes/no toggle
- **Date**: a calendar date, picked with a date picker and shown in your date format
- **Link**: a web address starting with `http://` or `https://`, shown as a clickable link that opens in a new tab
- **Single-select**: one value chosen from a list of options you define
- **Multi-select**: any number of values chosen from a list of options you define, shown as checkboxes
- **Person**: a link to another person in Nametag, picked by searching their name. On the person's page it shows as a link to that person

When you create a Single-select or Multi-select field, you'll also define the list of allowed options. A field's type can't be changed after creation, since existing values on people already depend on it, but the name and options can still be edited. Renaming a single option (removing one and adding one in the same save) updates every person who had the old option, for both select types.

Date fields also appear on the [calendar](/features/calendar/) as one-time events, titled with the field's name.

If the person a Person field links to is deleted, the field shows "Linked person no longer exists" until you pick someone else or clear it. When you [merge two people](/features/duplicates/), Person fields that pointed at the merged-away person point at the person you kept.

## Reordering templates

Use the up and down buttons next to each template in Settings > Custom Fields to reorder them. The order you set determines the order fields appear in on a person's edit and detail pages.

## Setting values on a person

On a person's edit page, every custom field template you've defined appears as an input, ready for a value. Leave any of them blank if they don't apply to that particular person.

## Filtering by custom field values

On the People page, **More filters** lets you pick a custom field and a value, and narrows the list to people whose field matches. The filter is kept in the `?cf=slug:value` URL parameter, for example `?cf=company:Acme`. This is useful for narrowing your list by anything you track as a custom field, like company, department, or a membership tier.

- **Text, Link, Number, Date, Yes / No and Single-select** match the whole value, ignoring case. Dates use the `YYYY-MM-DD` form in the URL
- **Multi-select** matches people who have that option among their selected options
- **Person** matches people linked to the person you pick. In the URL the value is that person's ID

The [advanced search](/features/search/#advanced-search) page also has a **Custom fields** box that matches any part of any custom field value, and Person fields by the linked person's name.

## Tier limits

In SaaS mode, the number of custom field templates you can define depends on your plan:

- **Free**: 1 custom field template
- **Personal**: up to 20 custom field templates
- **Pro**: unlimited custom field templates

Self-hosted installations are not subject to these limits.

## Limits and constraints

| Item | Limit |
| --- | --- |
| Available field types | TEXT, NUMBER, BOOLEAN, DATE, URL, SELECT, MULTI_SELECT, PERSON (8 types total) |
| Template name | up to 60 characters |
| SELECT and MULTI_SELECT option text | up to 100 characters |
| Max options per SELECT or MULTI_SELECT template | 50 |
| Max templates in reorder | 200 |
| Field value max length | 2,000 characters |
| Max custom field values per person | 200 |

### Stored value formats

Every value is stored as a string. The API and the JSON export use the same formats:

| Type | Stored value |
| --- | --- |
| TEXT | the text |
| NUMBER | a number, e.g. `42` or `3.5` |
| BOOLEAN | `true` or `false` |
| DATE | `YYYY-MM-DD`, e.g. `2024-05-31` |
| URL | an absolute `http` or `https` URL |
| SELECT | one of the template's options |
| MULTI_SELECT | a JSON array of options, e.g. `["Vegan","Gluten free"]`, with at least one entry and no duplicates |
| PERSON | the ID of another of your people who is not in the trash |

When you import a JSON export, Person values are pointed at the imported copy of the linked person. A Person value whose linked person is not part of the import is skipped.
