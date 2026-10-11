import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createModuleLogger } from './logger';
import { getPhotoStoragePath, validateFilePath } from './photo-storage';

const log = createModuleLogger('person-audio');

export const MAX_PERSON_AUDIO_UPLOAD_SIZE = 200 * 1024 * 1024; // 200MB
export const MAX_PERSON_AUDIO = 1000;
const MAX_ORIGINAL_NAME_LENGTH = 255;
// Chunk size used when streaming a file to the client
const STREAM_CHUNK_SIZE = 256 * 1024;

const SAFE_FILENAME = /^[a-z0-9]+\.mp3$/;

/**
 * Directory holding one person's audio folder:
 * {PHOTO_STORAGE_PATH}/{userId}/audio/{personId}
 */
export function getPersonAudioDir(userId: string, personId: string): string {
  const basePath = getPhotoStoragePath();
  const dirPath = path.join(basePath, userId, 'audio', personId);
  validateFilePath(dirPath, basePath);
  return dirPath;
}

/**
 * Check that a buffer looks like an MP3 file: either an ID3v2 tag or an MPEG
 * audio Layer III frame header at the start.
 */
export function isMp3Buffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  // ID3v2 tag ("ID3")
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;
  // Frame sync (11 bits set), a valid MPEG version and layer bits = Layer III
  const sync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  const version = (buffer[1] >> 3) & 0x03;
  const layer = (buffer[1] >> 1) & 0x03;
  return sync && version !== 0x01 && layer === 0x01;
}

/**
 * Read the recording time from a filename in the form YYMMDD_HHMM.mp3
 * (e.g. "241005_1430.mp3" is 5 October 2024, 14:30). Anything may follow the
 * minutes as long as it does not start with another digit, so "241005_1430 (2).mp3"
 * still matches. The wall-clock time is returned as a UTC Date so it reads back
 * the same in every timezone. Returns null when the name does not match or holds
 * an impossible date.
 */
export function parseRecordingTimestamp(filename: string): Date | null {
  const base = path.basename(filename);
  const match = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(?!\d)/.exec(base);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;

  const date = new Date(Date.UTC(2000 + year, month - 1, day, hour, minute));
  // Reject days that roll over into the next month (e.g. 240231)
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Clean an uploaded filename for display: keep only the last path segment,
 * drop control characters and cap the length.
 */
export function sanitizeOriginalName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'recording.mp3').slice(0, MAX_ORIGINAL_NAME_LENGTH);
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

/**
 * Write an MP3 file to the person's audio folder. Returns the stored filename.
 */
export async function savePersonAudioFile(
  userId: string,
  personId: string,
  audioId: string,
  buffer: Buffer
): Promise<string> {
  const filename = `${audioId}.mp3`;
  if (!SAFE_FILENAME.test(filename)) {
    throw new Error('Invalid audio id');
  }

  const dirPath = getPersonAudioDir(userId, personId);
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, filename);
  validateFilePath(filePath, getPhotoStoragePath());

  await atomicWrite(filePath, buffer);
  return filename;
}

export interface PersonAudioStream {
  stream: ReadableStream<Uint8Array>;
  start: number;
  end: number;
  totalSize: number;
}

/**
 * A parsed HTTP byte range. `start: null` is a suffix range ("bytes=-500" is the
 * last 500 bytes), `end: null` runs to the end of the file.
 */
export interface ByteRange {
  start: number | null;
  end: number | null;
}

/**
 * Parse a single-range HTTP Range header. Returns undefined when there is no
 * usable header, so the whole file is served. Malformed and multi-range
 * headers are ignored the same way, as RFC 9110 allows.
 */
export function parseRangeHeader(header: string | null): ByteRange | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return undefined;
  const start = match[1] === '' ? null : Number(match[1]);
  const end = match[2] === '' ? null : Number(match[2]);
  if (start === null && end === 0) return undefined;
  return { start, end };
}

/**
 * Open a file from a person's audio folder for streaming, optionally limited to
 * a byte range. Returns null if the file is missing and `unsatisfiable` when
 * the range lies outside the file.
 */
export async function openPersonAudioFile(
  userId: string,
  personId: string,
  filename: string,
  range?: ByteRange
): Promise<PersonAudioStream | { unsatisfiable: true; totalSize: number } | null> {
  if (!SAFE_FILENAME.test(filename)) return null;

  const filePath = path.join(getPersonAudioDir(userId, personId), filename);
  validateFilePath(filePath, getPhotoStoragePath());

  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error({ err: error instanceof Error ? error : new Error(String(error)), filename }, 'Failed to open person audio');
    }
    return null;
  }

  const { size: totalSize } = await handle.stat();
  let start = 0;
  let end = totalSize - 1;
  if (range) {
    if (range.start === null) {
      start = Math.max(0, totalSize - (range.end ?? 0));
    } else {
      start = range.start;
      if (range.end !== null) end = Math.min(range.end, totalSize - 1);
    }
  }
  if (range && (start >= totalSize || start > end)) {
    await handle.close();
    return { unsatisfiable: true, totalSize };
  }

  let position = start;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const length = Math.min(STREAM_CHUNK_SIZE, end - position + 1);
        const chunk = Buffer.alloc(Math.max(length, 0));
        const { bytesRead } = length > 0
          ? await handle.read(chunk, 0, length, position)
          : { bytesRead: 0 };
        if (bytesRead === 0) {
          await handle.close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, bytesRead));
      } catch (error) {
        await handle.close().catch(() => {});
        controller.error(error);
      }
    },
    async cancel() {
      await handle.close();
    },
  });

  return { stream, start, end, totalSize };
}

/**
 * Delete the given files from a person's audio folder. Missing files are ignored.
 */
export async function deletePersonAudioFiles(
  userId: string,
  personId: string,
  filenames: string[]
): Promise<void> {
  const basePath = getPhotoStoragePath();
  const dirPath = getPersonAudioDir(userId, personId);
  for (const filename of filenames) {
    if (!SAFE_FILENAME.test(filename)) continue;
    const filePath = path.join(dirPath, filename);
    validateFilePath(filePath, basePath);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error({ err: error instanceof Error ? error : new Error(String(error)), filename }, 'Failed to delete person audio');
      }
    }
  }
}

/**
 * Remove a person's whole audio folder from disk. Used when a person is
 * permanently deleted (database rows go away through the cascade).
 */
export async function deletePersonAudioDir(userId: string, personId: string): Promise<void> {
  try {
    await fs.rm(getPersonAudioDir(userId, personId), { recursive: true, force: true });
  } catch (error) {
    log.error({ err: error instanceof Error ? error : new Error(String(error)), personId }, 'Failed to delete person audio folder');
  }
}
