import fs from 'fs/promises';
import path from 'path';
import { createModuleLogger } from './logger';

const log = createModuleLogger('file-range');

// Chunk size used when streaming a file to the client
const STREAM_CHUNK_SIZE = 256 * 1024;

export interface FileRangeStream {
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
 * Open a file for streaming, optionally limited to a byte range. The caller is
 * responsible for validating the path. Returns null if the file is missing and
 * `unsatisfiable` when the range lies outside the file.
 */
export async function openFileRange(
  filePath: string,
  range?: ByteRange
): Promise<FileRangeStream | { unsatisfiable: true; totalSize: number } | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error(
        { err: error instanceof Error ? error : new Error(String(error)), file: path.basename(filePath) },
        'Failed to open file'
      );
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

// Content-Disposition value that keeps non-ASCII filenames intact (RFC 6266)
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
