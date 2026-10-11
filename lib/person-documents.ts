import { prisma } from './prisma';
import { createModuleLogger } from './logger';
import {
  deleteDocumentBlob,
  deleteLegacyGalleryDir,
  deleteLegacyImage,
  detectMimeType,
  makeThumbnail,
  readLegacyImage,
  sanitizeOriginalName,
  sha256Hex,
  storeDocumentBlob,
  withBlobLock,
} from './person-document-storage';

const log = createModuleLogger('person-documents');

export const documentSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  size: true,
  width: true,
  height: true,
  hasThumbnail: true,
  createdAt: true,
} as const;

/**
 * Remove a blob when no document of this user points at it any more.
 * Documents of people in the trash still count. Call inside withBlobLock.
 */
async function deleteBlobIfUnreferenced(userId: string, sha256: string): Promise<boolean> {
  const references = await prisma.personDocument.count({
    where: { sha256, person: { userId } },
  });
  if (references > 0) return false;
  await deleteDocumentBlob(userId, sha256);
  return true;
}

/**
 * Add a file to a person's document folder. Identical bytes are stored once
 * per user; adding a file the person already has returns the existing entry.
 */
export async function addPersonDocument(
  userId: string,
  personId: string,
  data: Buffer,
  originalName: string,
  clientType: string
) {
  const sha256 = sha256Hex(data);
  const mimeType = detectMimeType(data, clientType);

  return withBlobLock(userId, sha256, async () => {
    const existing = await prisma.personDocument.findFirst({
      where: { personId, sha256 },
      select: documentSelect,
    });
    if (existing) {
      return { document: existing, duplicate: true };
    }

    const thumb = await makeThumbnail(data, mimeType);
    await storeDocumentBlob(userId, sha256, data, thumb?.thumbnail ?? null);

    try {
      const document = await prisma.personDocument.create({
        data: {
          personId,
          sha256,
          originalName: sanitizeOriginalName(originalName),
          mimeType,
          size: data.length,
          width: thumb?.width ?? null,
          height: thumb?.height ?? null,
          hasThumbnail: thumb !== null,
        },
        select: documentSelect,
      });
      return { document, duplicate: false };
    } catch (error) {
      await deleteBlobIfUnreferenced(userId, sha256);
      throw error;
    }
  });
}

/**
 * Delete one document entry, and its file once nothing else uses it.
 */
export async function removePersonDocument(
  userId: string,
  document: { id: string; personId: string; sha256: string | null; legacyFilename: string | null }
): Promise<void> {
  const { sha256, legacyFilename } = document;
  if (sha256) {
    await withBlobLock(userId, sha256, async () => {
      await prisma.personDocument.delete({ where: { id: document.id } });
      await deleteBlobIfUnreferenced(userId, sha256);
    });
    return;
  }

  await prisma.personDocument.delete({ where: { id: document.id } });
  if (legacyFilename) {
    await deleteLegacyImage(userId, document.personId, legacyFilename);
  }
}

/**
 * Delete all of a person's documents, and every file nothing else uses.
 * Used when a person is permanently deleted.
 */
export async function removeAllPersonDocuments(userId: string, personId: string): Promise<void> {
  const documents = await prisma.personDocument.findMany({
    where: { personId },
    select: { sha256: true },
  });
  await prisma.personDocument.deleteMany({ where: { personId } });

  const hashes = new Set(documents.map((d) => d.sha256).filter((h): h is string => h !== null));
  for (const sha256 of hashes) {
    try {
      await withBlobLock(userId, sha256, () => deleteBlobIfUnreferenced(userId, sha256));
    } catch (error) {
      log.error({ err: error instanceof Error ? error : new Error(String(error)), personId }, 'Failed to clean up document file');
    }
  }
  await deleteLegacyGalleryDir(userId, personId);
}

/**
 * Move images from the old per-person image folder into the hashed document
 * store. Runs at startup and is safe to repeat: each image is copied, its row
 * updated, and only then the old files are removed. Images whose file is
 * missing are left alone and keep being served (or not) from the old path.
 */
export async function migrateLegacyImages(): Promise<{ moved: number; missing: number }> {
  const pending = await prisma.personDocument.findMany({
    where: { sha256: null, legacyFilename: { not: null } },
    select: { id: true, personId: true, legacyFilename: true, person: { select: { userId: true } } },
  });
  let moved = 0;
  let missing = 0;

  for (const doc of pending) {
    const userId = doc.person.userId;
    const filename = doc.legacyFilename as string;
    try {
      const legacy = await readLegacyImage(userId, doc.personId, filename);
      if (!legacy) {
        missing += 1;
        log.warn({ documentId: doc.id, personId: doc.personId }, 'Old image file not found, leaving it in place');
        continue;
      }

      const sha256 = sha256Hex(legacy.data);
      await withBlobLock(userId, sha256, async () => {
        await storeDocumentBlob(userId, sha256, legacy.data, legacy.thumbnail);
        await prisma.personDocument.update({
          where: { id: doc.id },
          data: { sha256, legacyFilename: null, size: legacy.data.length },
        });
      });
      await deleteLegacyImage(userId, doc.personId, filename);
      moved += 1;
    } catch (error) {
      log.error({ err: error instanceof Error ? error : new Error(String(error)), documentId: doc.id }, 'Failed to move old image');
    }
  }

  if (pending.length > 0) {
    log.info({ moved, missing }, 'Moved old image folder files into the document store');
  }
  return { moved, missing };
}
