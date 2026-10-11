import { deletePersonPhotos } from '@/lib/photo-storage';
import { removeAllPersonDocuments } from '@/lib/person-documents';
import { deletePersonAudioDir } from '@/lib/person-audio-storage';

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
