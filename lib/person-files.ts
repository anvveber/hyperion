import fs from 'fs/promises';
import path from 'path';
import { deletePersonPhotos, getPhotoStoragePath, validateFilePath } from '@/lib/photo-storage';
import { removeAllPersonDocuments } from '@/lib/person-documents';
import { deletePersonAudioDir } from '@/lib/person-audio-storage';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('person-files');

// User IDs are cuids; anything else (empty, dots, slashes) must never reach rm
const USER_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Remove every file stored on disk for a person: photos, the document folder
 * (entries, plus files no other document uses) and the audio folder. Call this whenever a person is permanently deleted,
 * so any new per-person storage only needs to be added here.
 */
export async function deletePersonFiles(userId: string, personId: string): Promise<void> {
  await deletePersonPhotos(userId, personId);
  await removeAllPersonDocuments(userId, personId);
  await deletePersonAudioDir(userId, personId);
}

/**
 * Remove a user's whole storage folder ({PHOTO_STORAGE_PATH}/{userId}): their
 * own photo and every person's photos, documents and audio. Call this after
 * the account row is deleted; the database cascade does not touch the disk.
 */
export async function deleteUserFiles(userId: string): Promise<void> {
  if (!USER_ID.test(userId)) {
    log.error({ userId }, 'Refusing to delete storage for an invalid user ID');
    return;
  }
  try {
    const basePath = getPhotoStoragePath();
    const dirPath = path.join(basePath, userId);
    validateFilePath(dirPath, basePath);
    if (path.resolve(dirPath) === path.resolve(basePath)) return;
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    log.error({ err: error instanceof Error ? error : new Error(String(error)), userId }, 'Failed to delete user files');
  }
}
