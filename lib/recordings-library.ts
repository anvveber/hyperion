import fs from 'fs/promises';
import path from 'path';
import { createModuleLogger } from './logger';
import { parseRecordingTimestamp } from './person-audio-storage';
import { openFileRange, type ByteRange, type FileRangeStream } from './file-range';

/*
 * Read-only access to a voice-recording archive on the server, so recordings
 * can be added to a person's audio folder straight from it, transcript
 * included. The expected layout (the one the voice pipeline writes):
 *
 *   {root}/archive/YYYY/MM/yymmdd_hhmm.mp3     the recordings
 *   {root}/text/YYYY/MM/yymmdd_hhmm.json        whisper.cpp JSON (-oj)
 *   {root}/index.db                             SQLite FTS5 index (optional)
 *
 * Set RECORDINGS_LIBRARY_PATH to {root}; each part can be moved with its own
 * variable. Nothing here writes to the library. When the index is there,
 * search uses it (full FTS5 syntax: AND, OR, NOT, "phrases", prefix*) and
 * transcripts come from its cleaned segments; otherwise transcripts are read
 * from the JSON files and search is unavailable.
 */

const log = createModuleLogger('recordings-library');

export interface LibraryConfig {
  archiveDir: string;
  textDir: string;
  indexDb: string;
}

export interface LibraryRecording {
  path: string;
  name: string;
  recordedAt: string | null;
  size: number;
  durationMs: number | null;
  hasTranscript: boolean;
  preview: string | null;
}

export interface LibraryMonth {
  year: string;
  month: string;
  count: number;
}

export interface TranscriptSegment {
  s: number;
  e: number;
  t: string;
}

export interface LibraryTranscript {
  language: string | null;
  durationMs: number | null;
  segments: TranscriptSegment[];
}

/** A search hit. The snippet marks matches with \u0002 ... \u0003. */
export interface LibrarySearchHit {
  path: string;
  name: string;
  recordedAt: string | null;
  durationMs: number | null;
  snippet: string;
}

export class LibraryQueryError extends Error {}

// YYYY/MM/<name>.mp3, where the name is the recorder's yymmdd_hhmm with an
// optional _NN continuation suffix, or any other plain file name.
const RECORDING_PATH = /^(\d{4})\/(\d{2})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,120})\.mp3$/;
const YEAR = /^\d{4}$/;
const MONTH = /^(0[1-9]|1[0-2])$/;
const PREVIEW_LENGTH = 160;
export const MAX_SEARCH_RESULTS = 50;

/** Library locations from the environment, or null when no library is configured. */
export function getLibraryConfig(): LibraryConfig | null {
  const root = process.env.RECORDINGS_LIBRARY_PATH?.trim();
  if (!root) return null;
  return {
    archiveDir: path.resolve(process.env.RECORDINGS_ARCHIVE_DIR?.trim() || path.join(root, 'archive')),
    textDir: path.resolve(process.env.RECORDINGS_TEXT_DIR?.trim() || path.join(root, 'text')),
    indexDb: path.resolve(process.env.RECORDINGS_INDEX_DB?.trim() || path.join(root, 'index.db')),
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Whether the archive folder is there and readable. */
export async function isLibraryAvailable(config: LibraryConfig): Promise<boolean> {
  return exists(config.archiveDir);
}

/** Whether the search index is there. */
export async function hasSearchIndex(config: LibraryConfig): Promise<boolean> {
  return exists(config.indexDb);
}

/** Check a library-relative recording path. Returns its parts, or null. */
export function parseRecordingPath(rel: string): { year: string; month: string; stem: string } | null {
  const match = RECORDING_PATH.exec(rel);
  if (!match) return null;
  const [, year, month, stem] = match;
  if (!MONTH.test(month) || stem.includes('..')) return null;
  return { year, month, stem };
}

/**
 * Resolve a library-relative path to an absolute file inside the archive,
 * following symlinks, and refuse anything that ends up outside it.
 */
export async function resolveRecording(config: LibraryConfig, rel: string): Promise<string | null> {
  if (!parseRecordingPath(rel)) return null;
  try {
    const root = await fs.realpath(config.archiveDir);
    const real = await fs.realpath(path.join(config.archiveDir, rel));
    if (!real.startsWith(root + path.sep)) return null;
    const stat = await fs.stat(real);
    return stat.isFile() ? real : null;
  } catch {
    return null;
  }
}

function transcriptJsonPath(config: LibraryConfig, rel: string): string {
  return path.join(config.textDir, rel.replace(/\.mp3$/, '.json'));
}

function transcriptTxtPath(config: LibraryConfig, rel: string): string {
  return path.join(config.textDir, rel.replace(/\.mp3$/, '.txt'));
}

function recordedAtIso(name: string): string | null {
  return parseRecordingTimestamp(name)?.toISOString() ?? null;
}

type Sqlite = typeof import('node:sqlite');

async function openIndex(config: LibraryConfig): Promise<InstanceType<Sqlite['DatabaseSync']> | null> {
  if (!(await exists(config.indexDb))) return null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(config.indexDb, { readOnly: true });
  } catch (error) {
    log.warn({ err: error instanceof Error ? error : new Error(String(error)) }, 'Could not open the recordings index');
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

/** Years and months in the archive that hold recordings, newest first. */
export async function listMonths(config: LibraryConfig): Promise<LibraryMonth[]> {
  const months: LibraryMonth[] = [];
  const years = (await fs.readdir(config.archiveDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && YEAR.test(d.name))
    .map((d) => d.name);
  for (const year of years) {
    const monthDirs = (await fs.readdir(path.join(config.archiveDir, year), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && MONTH.test(d.name))
      .map((d) => d.name);
    for (const month of monthDirs) {
      const files = await fs.readdir(path.join(config.archiveDir, year, month));
      const count = files.filter((f) => f.toLowerCase().endsWith('.mp3')).length;
      if (count > 0) months.push({ year, month, count });
    }
  }
  return months.sort((a, b) => (a.year === b.year ? b.month.localeCompare(a.month) : b.year.localeCompare(a.year)));
}

/** The recordings of one month, newest first, with a short transcript preview. */
export async function listMonth(config: LibraryConfig, year: string, month: string): Promise<LibraryRecording[]> {
  if (!YEAR.test(year) || !MONTH.test(month)) return [];
  const dir = path.join(config.archiveDir, year, month);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const db = await openIndex(config);
  const durationStmt = db?.prepare('SELECT duration_ms FROM recordings WHERE path = ?');
  try {
    const recordings: LibraryRecording[] = [];
    for (const file of entries.filter((f) => f.endsWith('.mp3'))) {
      const rel = `${year}/${month}/${file}`;
      if (!parseRecordingPath(rel)) continue;
      const stat = await fs.stat(path.join(dir, file)).catch(() => null);
      if (!stat?.isFile()) continue;

      let preview: string | null = null;
      try {
        const handle = await fs.open(transcriptTxtPath(config, rel), 'r');
        try {
          const buf = Buffer.alloc(PREVIEW_LENGTH * 4);
          const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
          const text = buf.subarray(0, bytesRead).toString('utf8').replace(/�+$/, '').replace(/\s+/g, ' ').trim();
          preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : text || null;
        } finally {
          await handle.close();
        }
      } catch {
        preview = null;
      }

      recordings.push({
        path: rel,
        name: file,
        recordedAt: recordedAtIso(file),
        size: stat.size,
        durationMs: asNumber(durationStmt?.get(rel)?.duration_ms),
        hasTranscript: preview !== null || (await exists(transcriptJsonPath(config, rel))),
        preview,
      });
    }
    return recordings.sort((a, b) => b.name.localeCompare(a.name));
  } finally {
    db?.close();
  }
}

/**
 * Full-text search over the transcripts, newest recording first. The query
 * uses FTS5 syntax as typed. Returns null when there is no index.
 */
export async function searchLibrary(config: LibraryConfig, query: string): Promise<LibrarySearchHit[] | null> {
  const db = await openIndex(config);
  if (!db) return null;
  try {
    const rows = db
      .prepare(
        `SELECT r.path AS path, r.duration_ms AS duration_ms,
                snippet(docs, 0, char(2), char(3), '…', 14) AS snippet
           FROM docs JOIN recordings r ON r.id = docs.rec_id
          WHERE docs MATCH ?
          ORDER BY r.recorded_at DESC
          LIMIT ${MAX_SEARCH_RESULTS}`
      )
      .all(query);
    return rows
      .filter((row) => typeof row.path === 'string' && parseRecordingPath(row.path))
      .map((row) => {
        const rel = String(row.path);
        const name = rel.split('/').pop() ?? rel;
        return {
          path: rel,
          name,
          recordedAt: recordedAtIso(name),
          durationMs: asNumber(row.duration_ms),
          snippet: typeof row.snippet === 'string' ? row.snippet : '',
        };
      });
  } catch (error) {
    // FTS5 reports malformed queries ("fts5: syntax error ...") as errors.
    const message = error instanceof Error ? error.message : String(error);
    if (/fts5|syntax|no such column|unterminated/i.test(message)) {
      throw new LibraryQueryError(message);
    }
    throw error;
  } finally {
    db.close();
  }
}

/** Parse whisper.cpp JSON (-oj) into segments. */
export function parseWhisperJson(raw: unknown): LibraryTranscript | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as { transcription?: unknown; result?: { language?: unknown } };
  if (!Array.isArray(data.transcription)) return null;
  const segments: TranscriptSegment[] = [];
  for (const item of data.transcription) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as { offsets?: { from?: unknown; to?: unknown }; text?: unknown };
    const s = asNumber(seg.offsets?.from);
    const e = asNumber(seg.offsets?.to);
    const t = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (s === null || e === null || !t) continue;
    segments.push({ s, e, t });
  }
  const language = typeof data.result?.language === 'string' ? data.result.language : null;
  const last = segments.at(-1);
  return { language, durationMs: last ? last.e : null, segments };
}

/**
 * The transcript of one recording. The index's segments are preferred: the
 * indexer has already dropped silence hallucinations and repeated lines. The
 * raw JSON is the fallback. Returns null when there is no transcript.
 */
export async function readTranscript(config: LibraryConfig, rel: string): Promise<LibraryTranscript | null> {
  if (!parseRecordingPath(rel)) return null;

  const db = await openIndex(config);
  if (db) {
    try {
      const rec = db.prepare('SELECT id, language, duration_ms FROM recordings WHERE path = ?').get(rel);
      if (rec) {
        const rows = db
          .prepare('SELECT start_ms, end_ms, text FROM segments WHERE rec_id = ? ORDER BY CAST(start_ms AS INTEGER)')
          .all(rec.id ?? null);
        const segments = rows
          .map((r) => ({ s: asNumber(r.start_ms) ?? 0, e: asNumber(r.end_ms) ?? 0, t: String(r.text ?? '').trim() }))
          .filter((seg) => seg.t.length > 0);
        if (segments.length > 0) {
          return {
            language: typeof rec.language === 'string' ? rec.language : null,
            durationMs: asNumber(rec.duration_ms),
            segments,
          };
        }
      }
    } catch (error) {
      log.warn({ err: error instanceof Error ? error : new Error(String(error)), rel }, 'Could not read transcript from the index');
    } finally {
      db.close();
    }
  }

  try {
    const raw: unknown = JSON.parse(await fs.readFile(transcriptJsonPath(config, rel), 'utf8'));
    const parsed = parseWhisperJson(raw);
    return parsed && parsed.segments.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Stream a library recording, optionally a byte range of it. */
export async function openLibraryRecording(
  config: LibraryConfig,
  rel: string,
  range?: ByteRange
): Promise<FileRangeStream | { unsatisfiable: true; totalSize: number } | null> {
  const file = await resolveRecording(config, rel);
  if (!file) return null;
  return openFileRange(file, range);
}
