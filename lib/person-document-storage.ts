import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { createModuleLogger } from './logger';
import { getPhotoStoragePath, validateFilePath } from './photo-storage';
import { openFileRange, type ByteRange, type FileRangeStream } from './file-range';

const log = createModuleLogger('person-documents');

export const MAX_PERSON_DOCUMENT_UPLOAD_SIZE = 200 * 1024 * 1024; // 200MB
export const MAX_PERSON_DOCUMENTS = 1000;
const MAX_ORIGINAL_NAME_LENGTH = 255;
const THUMBNAIL_SIZE = 400;
const THUMBNAIL_QUALITY = 75;
// Same decoded-pixel bound as profile photos (see photo-storage.ts)
const SHARP_MAX_INPUT_PIXELS = 100 * 1024 * 1024;

const SHA256 = /^[a-f0-9]{64}$/;
// File names used by the old image folder: "{id}.jpg" and "{id}_thumb.jpg"
const LEGACY_FILENAME = /^[a-z0-9]+\.(jpg|png)$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

// Image types sharp can read for thumbnails
const THUMBNAIL_SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/**
 * Directory holding a user's document blobs, named by SHA-256:
 * {PHOTO_STORAGE_PATH}/{userId}/documents/{first two hex chars}/{sha256}
 * Thumbnails sit next to them as {sha256}.thumb.
 */
export function getDocumentStoreDir(userId: string): string {
  const basePath = getPhotoStoragePath();
  const dirPath = path.join(basePath, userId, 'documents');
  validateFilePath(dirPath, basePath);
  return dirPath;
}

function blobPaths(userId: string, sha256: string): { blob: string; thumb: string } {
  if (!SHA256.test(sha256)) {
    throw new Error('Invalid document hash');
  }
  const dir = path.join(getDocumentStoreDir(userId), sha256.slice(0, 2));
  const blob = path.join(dir, sha256);
  validateFilePath(blob, getPhotoStoragePath());
  return { blob, thumb: `${blob}.thumb` };
}

/**
 * Directory of the old per-person image folder:
 * {PHOTO_STORAGE_PATH}/{userId}/gallery/{personId}
 */
export function getLegacyGalleryDir(userId: string, personId: string): string {
  const basePath = getPhotoStoragePath();
  const dirPath = path.join(basePath, userId, 'gallery', personId);
  validateFilePath(dirPath, basePath);
  return dirPath;
}

function legacyPaths(userId: string, personId: string, filename: string): { file: string; thumb: string } | null {
  if (!LEGACY_FILENAME.test(filename)) return null;
  const dir = getLegacyGalleryDir(userId, personId);
  const thumbName = filename.replace(/\.(jpg|png)$/, '_thumb.$1');
  return { file: path.join(dir, filename), thumb: path.join(dir, thumbName) };
}

export function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Keep only the last path segment, without control characters, so the name
 * is safe to echo back in a Content-Disposition header.
 */
export function sanitizeOriginalName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, MAX_ORIGINAL_NAME_LENGTH);
}

function hasBytes(buffer: Buffer, bytes: number[] | string, offset = 0): boolean {
  const expected = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
  if (buffer.length < offset + expected.length) return false;
  return buffer.subarray(offset, offset + expected.length).equals(expected);
}

/**
 * Work out a file's MIME type from its first bytes. The type the browser sent
 * is only used for formats that are not recognised here, and never for the
 * types the folder shows inline, so a file cannot pass itself off as an image
 * or a PDF.
 */
export function detectMimeType(buffer: Buffer, clientType: string): string {
  if (hasBytes(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (hasBytes(buffer, 'GIF87a') || hasBytes(buffer, 'GIF89a')) return 'image/gif';
  if (hasBytes(buffer, 'RIFF')) {
    if (hasBytes(buffer, 'WEBP', 8)) return 'image/webp';
    if (hasBytes(buffer, 'WAVE', 8)) return 'audio/wav';
    if (hasBytes(buffer, 'AVI ', 8)) return 'video/x-msvideo';
  }
  if (hasBytes(buffer, '%PDF-')) return 'application/pdf';
  if (hasBytes(buffer, 'ftyp', 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand === 'qt  ') return 'video/quicktime';
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'avif') return 'image/avif';
    if (brand === 'M4A ') return 'audio/mp4';
    return 'video/mp4';
  }
  if (hasBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return buffer.subarray(0, 64).includes('webm') ? 'video/webm' : 'video/x-matroska';
  }
  if (hasBytes(buffer, 'OggS')) return 'audio/ogg';
  if (hasBytes(buffer, 'fLaC')) return 'audio/flac';
  if (hasBytes(buffer, 'ID3') || (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe6) === 0xe2)) {
    return 'audio/mpeg';
  }

  const claimed = clientType.split(';')[0].trim().toLowerCase();
  if (!MIME_TYPE.test(claimed)) return 'application/octet-stream';
  // Types we recognise by content must have matched above
  const sniffed = /^(image|video|audio)\//.test(claimed) || claimed === 'application/pdf';
  if (sniffed) return 'application/octet-stream';
  if (claimed === 'text/plain') return isProbablyText(buffer) ? 'text/plain' : 'application/octet-stream';
  return claimed;
}

function isProbablyText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 8192).includes(0);
}

export interface DocumentThumbnail {
  thumbnail: Buffer;
  width: number;
  height: number;
}

/**
 * Build a square thumbnail for an image. Returns null for other types and for
 * images sharp cannot read; the file is still stored, just without a preview.
 */
export async function makeThumbnail(buffer: Buffer, mimeType: string): Promise<DocumentThumbnail | null> {
  if (!THUMBNAIL_SOURCE_TYPES.has(mimeType)) return null;
  try {
    const options = { limitInputPixels: SHARP_MAX_INPUT_PIXELS };
    const metadata = await sharp(buffer, options).metadata();
    const pipeline = sharp(buffer, options)
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', withoutEnlargement: true });
    const thumbnail = metadata.hasAlpha
      ? await pipeline.png().toBuffer()
      : await pipeline.jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer();
    // EXIF orientations 5-8 swap width and height on display
    const swapped = (metadata.orientation ?? 1) >= 5;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    return { thumbnail, width: swapped ? height : width, height: swapped ? width : height };
  } catch (error) {
    log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Could not build thumbnail');
    return null;
  }
}

async function atomicWrite(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = path.join(path.dirname(filePath), `.nametag-tmp-${crypto.randomBytes(8).toString('hex')}`);
  await fs.writeFile(tmpPath, data);
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return null;
  }
}

// Serialises work on one blob (store, reference check, delete) inside this
// process, so a delete never removes a file that an upload is just reusing.
const blobLocks = new Map<string, Promise<unknown>>();

export async function withBlobLock<T>(userId: string, sha256: string, fn: () => Promise<T>): Promise<T> {
  const key = `${userId}:${sha256}`;
  const previous = blobLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => {});
  blobLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (blobLocks.get(key) === tail) blobLocks.delete(key);
  }
}

/**
 * Store a file under its hash. If the same bytes are already stored, nothing
 * is written. A thumbnail is written when given and none exists yet.
 * Call inside withBlobLock.
 */
export async function storeDocumentBlob(
  userId: string,
  sha256: string,
  data: Buffer,
  thumbnail: Buffer | null
): Promise<void> {
  const paths = blobPaths(userId, sha256);
  await fs.mkdir(path.dirname(paths.blob), { recursive: true });

  if ((await fileSize(paths.blob)) !== data.length) {
    await atomicWrite(paths.blob, data);
  }
  if (thumbnail && (await fileSize(paths.thumb)) === null) {
    await atomicWrite(paths.thumb, thumbnail);
  }
}

/**
 * Remove a stored file and its thumbnail. Missing files are ignored.
 * Call inside withBlobLock, after checking nothing references it.
 */
export async function deleteDocumentBlob(userId: string, sha256: string): Promise<void> {
  const paths = blobPaths(userId, sha256);
  for (const filePath of [paths.blob, paths.thumb]) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error({ err: error instanceof Error ? error : new Error(String(error)), sha256 }, 'Failed to delete document file');
      }
    }
  }
  // Drop the two-character shard directory once it is empty
  await fs.rmdir(path.dirname(paths.blob)).catch(() => {});
}

export type DocumentLocation =
  | { kind: 'blob'; sha256: string }
  | { kind: 'legacy'; personId: string; legacyFilename: string };

/**
 * Open a stored document for streaming, optionally limited to a byte range.
 * Documents not yet moved out of the old image folder are read from there.
 */
export async function openDocumentFile(
  userId: string,
  location: DocumentLocation,
  range?: ByteRange
): Promise<FileRangeStream | { unsatisfiable: true; totalSize: number } | null> {
  const filePath = location.kind === 'blob'
    ? blobPaths(userId, location.sha256).blob
    : legacyPaths(userId, location.personId, location.legacyFilename)?.file;
  if (!filePath) return null;
  validateFilePath(filePath, getPhotoStoragePath());
  return openFileRange(filePath, range);
}

/**
 * Read a document's thumbnail. Returns null if there is none.
 */
export async function readDocumentThumbnail(
  userId: string,
  location: DocumentLocation
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const filePath = location.kind === 'blob'
    ? blobPaths(userId, location.sha256).thumb
    : legacyPaths(userId, location.personId, location.legacyFilename)?.thumb;
  if (!filePath) return null;
  try {
    validateFilePath(filePath, getPhotoStoragePath());
    const buffer = await fs.readFile(filePath);
    const mimeType = hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47]) ? 'image/png' : 'image/jpeg';
    return { buffer, mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error({ err: error instanceof Error ? error : new Error(String(error)) }, 'Failed to read document thumbnail');
    }
    return null;
  }
}

/**
 * Read a file and its thumbnail from the old image folder.
 * Returns null if the file is missing.
 */
export async function readLegacyImage(
  userId: string,
  personId: string,
  filename: string
): Promise<{ data: Buffer; thumbnail: Buffer | null } | null> {
  const paths = legacyPaths(userId, personId, filename);
  if (!paths) return null;
  try {
    const data = await fs.readFile(paths.file);
    const thumbnail = await fs.readFile(paths.thumb).catch(() => null);
    return { data, thumbnail };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}

/**
 * Delete a file and its thumbnail from the old image folder, then the folder
 * itself (and the user's gallery folder) once they are empty.
 */
export async function deleteLegacyImage(userId: string, personId: string, filename: string): Promise<void> {
  const paths = legacyPaths(userId, personId, filename);
  if (!paths) return;
  await fs.unlink(paths.file).catch(() => {});
  await fs.unlink(paths.thumb).catch(() => {});
  const dir = getLegacyGalleryDir(userId, personId);
  await fs.rmdir(dir).catch(() => {});
  await fs.rmdir(path.dirname(dir)).catch(() => {});
}

/**
 * Remove what is left of a person's old image folder. Used when a person is
 * permanently deleted.
 */
export async function deleteLegacyGalleryDir(userId: string, personId: string): Promise<void> {
  try {
    const dir = getLegacyGalleryDir(userId, personId);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rmdir(path.dirname(dir)).catch(() => {});
  } catch (error) {
    log.error({ err: error instanceof Error ? error : new Error(String(error)), personId }, 'Failed to delete old image folder');
  }
}
