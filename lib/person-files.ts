import { deletePersonPhotos } from '@/lib/photo-storage';
import { deletePersonImageDir } from '@/lib/person-image-storage';
import { deletePersonAudioDir } from '@/lib/person-audio-storage';

/**
 * Remove every file stored on disk for a person: photos, the image folder
 * and the audio folder. Call this whenever a person is permanently deleted,
 * so any new per-person storage only needs to be added here.
 */
export async function deletePersonFiles(userId: string, personId: string): Promise<void> {
  await deletePersonPhotos(userId, personId);
  await deletePersonImageDir(userId, personId);
  await deletePersonAudioDir(userId, personId);
}
