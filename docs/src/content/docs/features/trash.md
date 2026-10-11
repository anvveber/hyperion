---
title: Trash & Restore
description: Recover deleted items from the trash.
sidebar:
  order: 15
---

Deleting something in Nametag doesn't erase it right away. It gives you a safety net.

## Soft delete

When you delete a person, group, relationship, relationship type, or important date, it isn't removed immediately. Instead, it's moved to trash, marked as deleted but kept in the database.

## Retention

By default, trashed items stay in the trash until you restore them or delete them permanently. Nothing is removed automatically.

The person running your Nametag instance can choose to have old trash purged instead, by setting `TRASH_RETENTION_DAYS` to a number of days (see [Configuration](/self-hosting/configuration/)). In that case, trashed items stay recoverable for that many days from the moment they're deleted, and the delete dialogs and the Trash page tell you how long you have.

## Viewing and restoring trash

Go to **Settings > Trash** to see all deleted items. Items are organized by type using tabs: People, Groups, Relationships, Relationship Types, and Important Dates. Each tab shows a count of deleted items.

When a retention period is set, each item shows how many days remain before it's automatically purged. Click **Restore** to bring it back into your active data.

## Permanent delete

You can permanently delete individual items from the Trash page. Click **Delete permanently** on any item and confirm the action. This is irreversible.

When a person is permanently deleted, their associated data goes with them: relationships, group memberships, custom field values, photos, and the files in their image and audio folders.

## Automatic purge

A background job called `purge-deleted` runs daily at 3am. When `TRASH_RETENTION_DAYS` is set to a number, it permanently removes anything that has been sitting in trash for longer than that, including the photos, image files and audio recordings of purged people. Once an item is purged this way, it's gone for good and can't be recovered. When `TRASH_RETENTION_DAYS` is `never` (the default), the job does nothing.
