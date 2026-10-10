import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { createModuleLogger } from './logger';
import { getPhotoStoragePath, isValidImageBuffer, validateFilePath } from './photo-storage';

const log = createModuleLogger('person-images');

export const MAX_PERSON_IMAGE_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_PERSON_IMAGES = 500;
const MAX_DIMENSION = 2560;
const THUMBNAIL_SIZE = 400;
const JPEG_QUALITY = 85;
const THUMBNAIL_QUALITY = 75;
// Same decoded-pixel bound as profile photos (see photo-storage.ts)
const SHARP_MAX_INPUT_PIXELS = 100 * 1024 * 1024;

const SAFE_FILENAME = /^[a-z0-9]+(_thumb)?\.(jpg|png)$/;

/**
 * Directory holding one person's image folder:
 * {PHOTO_STORAGE_PATH}/{userId}/gallery/{personId}
 */
export function getPersonImageDir(userId: string, personId: string): string {
  const basePath = getPhotoStoragePath();
  const dirPath = path.join(basePath, userId, 'gallery', personId);
  validateFilePath(dirPath, basePath);
  return dirPath;
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

export interface ProcessedPersonImage {
  full: Buffer;
  thumbnail: Buffer;
  ext: 'jpg' | 'png';
  width: number;
  height: number;
}

/**
 * Validate and process an uploaded image: auto-rotate, strip EXIF, scale down
 * to at most MAX_DIMENSION on the long side (never upscale) and build a square
 * thumbnail. Images with transparency are kept as PNG, everything else is JPEG.
 * Throws on invalid input.
 */
export async function processPersonImage(buffer: Buffer): Promise<ProcessedPersonImage> {
  if (!isValidImageBuffer(buffer)) {
    throw new Error('Unsupported image format. Supported: JPEG, PNG, GIF, WebP');
  }
  if (buffer.length > MAX_PERSON_IMAGE_UPLOAD_SIZE) {
    throw new Error(`Image exceeds maximum size of ${MAX_PERSON_IMAGE_UPLOAD_SIZE / (1024 * 1024)}MB`);
  }

  const options = { limitInputPixels: SHARP_MAX_INPUT_PIXELS };
  const metadata = await sharp(buffer, options).metadata();
  const hasAlpha = metadata.hasAlpha === true;
  const ext = hasAlpha ? 'png' : 'jpg';

  const fullPipeline = sharp(buffer, options)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  const fullResult = hasAlpha
    ? await fullPipeline.png().toBuffer({ resolveWithObject: true })
    : await fullPipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer({ resolveWithObject: true });

  const thumbPipeline = sharp(buffer, options)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', withoutEnlargement: true });
  const thumbnail = hasAlpha
    ? await thumbPipeline.png().toBuffer()
    : await thumbPipeline.jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer();

  return {
    full: fullResult.data,
    thumbnail,
    ext,
    width: fullResult.info.width,
    height: fullResult.info.height,
  };
}

/**
 * Write a processed image to the person's folder.
 * Returns the stored filenames.
 */
export async function savePersonImageFiles(
  userId: string,
  personId: string,
  imageId: string,
  image: ProcessedPersonImage
): Promise<{ filename: string; thumbnail: string }> {
  const dirPath = getPersonImageDir(userId, personId);
  await fs.mkdir(dirPath, { recursive: true });

  const filename = `${imageId}.${image.ext}`;
  const thumbnail = `${imageId}_thumb.${image.ext}`;
  if (!SAFE_FILENAME.test(filename) || !SAFE_FILENAME.test(thumbnail)) {
    throw new Error('Invalid image id');
  }

  const basePath = getPhotoStoragePath();
  const fullPath = path.join(dirPath, filename);
  const thumbPath = path.join(dirPath, thumbnail);
  validateFilePath(fullPath, basePath);
  validateFilePath(thumbPath, basePath);

  await atomicWrite(fullPath, image.full);
  try {
    await atomicWrite(thumbPath, image.thumbnail);
  } catch (err) {
    await fs.unlink(fullPath).catch(() => {});
    throw err;
  }

  return { filename, thumbnail };
}

/**
 * Read one file from a person's folder. Returns null if it is missing.
 */
export async function readPersonImageFile(
  userId: string,
  personId: string,
  filename: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!SAFE_FILENAME.test(filename)) return null;
  try {
    const filePath = path.join(getPersonImageDir(userId, personId), filename);
    validateFilePath(filePath, getPhotoStoragePath());
    const buffer = await fs.readFile(filePath);
    const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { buffer, mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error({ err: error instanceof Error ? error : new Error(String(error)), filename }, 'Failed to read person image');
    }
    return null;
  }
}

/**
 * Delete the given files from a person's folder. Missing files are ignored.
 */
export async function deletePersonImageFiles(
  userId: string,
  personId: string,
  filenames: string[]
): Promise<void> {
  const basePath = getPhotoStoragePath();
  const dirPath = getPersonImageDir(userId, personId);
  for (const filename of filenames) {
    if (!SAFE_FILENAME.test(filename)) continue;
    const filePath = path.join(dirPath, filename);
    validateFilePath(filePath, basePath);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error({ err: error instanceof Error ? error : new Error(String(error)), filename }, 'Failed to delete person image');
      }
    }
  }
}

/**
 * Remove a person's whole image folder from disk. Used when a person is
 * permanently deleted (database rows go away through the cascade).
 */
export async function deletePersonImageDir(userId: string, personId: string): Promise<void> {
  try {
    await fs.rm(getPersonImageDir(userId, personId), { recursive: true, force: true });
  } catch (error) {
    log.error({ err: error instanceof Error ? error : new Error(String(error)), personId }, 'Failed to delete person image folder');
  }
}
