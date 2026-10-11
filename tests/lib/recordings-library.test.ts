// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  getLibraryConfig,
  listMonth,
  listMonths,
  parseRecordingPath,
  parseWhisperJson,
  readTranscript,
  resolveRecording,
  searchLibrary,
  LibraryQueryError,
  type LibraryConfig,
} from '@/lib/recordings-library';

// A tiny MPEG frame header is enough: the library never decodes audio.
const MP3_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);

let root: string;
let config: LibraryConfig;

async function write(rel: string, data: string | Buffer) {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

function whisperJson(lang: string, segs: [number, number, string][]) {
  return JSON.stringify({
    result: { language: lang },
    transcription: segs.map(([from, to, text]) => ({ offsets: { from, to }, text: ` ${text}` })),
  });
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reclib-'));
  process.env.RECORDINGS_LIBRARY_PATH = root;
  config = getLibraryConfig() as LibraryConfig;

  await write('archive/2026/09/260914_1030.mp3', MP3_HEADER);
  await write('archive/2026/09/260920_2015_01.mp3', MP3_HEADER);
  await write('archive/2026/10/261003_0912.mp3', MP3_HEADER);
  await write('archive/2026/10/notes.txt', 'not audio');
  await write('archive/README', 'ignored');

  await write('text/2026/09/260914_1030.json', whisperJson('it', [[0, 4000, 'Il notaio ha firmato.'], [4000, 4500, 'Sottotitoli a cura di QTSS']]));
  await write('text/2026/09/260914_1030.txt', 'Il notaio ha firmato. Sottotitoli a cura di QTSS\n');
  await write('text/2026/10/261003_0912.json', whisperJson('en', [[0, 3000, 'Call with Mike about Zurich.']]));

  // The index, shaped like the voice pipeline's. It has dropped the junk line.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(config.indexDb);
  db.exec(`
    CREATE TABLE recordings (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, recorded_at TEXT, duration_ms INTEGER, language TEXT, model TEXT, json_mtime REAL);
    CREATE VIRTUAL TABLE docs USING fts5(text, rec_id UNINDEXED, tokenize = "unicode61 remove_diacritics 2");
    CREATE VIRTUAL TABLE segments USING fts5(text, rec_id UNINDEXED, start_ms UNINDEXED, end_ms UNINDEXED, tokenize = "unicode61 remove_diacritics 2");
    INSERT INTO recordings VALUES (1, '2026/09/260914_1030.mp3', '2026-09-14T10:30:00', 61000, 'it', 'large-v3', 0);
    INSERT INTO recordings VALUES (2, '2026/10/261003_0912.mp3', '2026-10-03T09:12:00', 3000, 'en', 'large-v3', 0);
    INSERT INTO docs VALUES ('Il notaio ha firmato perché era pronto.', 1);
    INSERT INTO docs VALUES ('Call with Mike about Zurich.', 2);
    INSERT INTO segments VALUES ('Il notaio ha firmato perché era pronto.', 1, 0, 4000);
    INSERT INTO segments VALUES ('Call with Mike about Zurich.', 2, 0, 3000);
  `);
  db.close();
});

afterAll(async () => {
  delete process.env.RECORDINGS_LIBRARY_PATH;
  await fs.rm(root, { recursive: true, force: true });
});

describe('parseRecordingPath', () => {
  it('accepts archive paths with the recorder names, including continuations', () => {
    expect(parseRecordingPath('2026/09/260914_1030.mp3')).toEqual({ year: '2026', month: '09', stem: '260914_1030' });
    expect(parseRecordingPath('2026/09/260920_2015_01.mp3')?.stem).toBe('260920_2015_01');
  });

  it('rejects anything that could leave the archive or is not an mp3', () => {
    for (const bad of ['../x.mp3', '2026/09/../../x.mp3', '/etc/passwd', '2026/13/a.mp3', '2026/09/a.wav', '2026/09/.hidden.mp3', '2026/9/a.mp3']) {
      expect(parseRecordingPath(bad)).toBeNull();
    }
  });
});

describe('resolveRecording', () => {
  it('finds files inside the archive', async () => {
    expect(await resolveRecording(config, '2026/09/260914_1030.mp3')).toBe(path.join(await fs.realpath(root), 'archive/2026/09/260914_1030.mp3'));
  });

  it('refuses missing files and symlinks that point outside', async () => {
    expect(await resolveRecording(config, '2026/09/000000_0000.mp3')).toBeNull();
    const outside = path.join(root, 'secret.mp3');
    await fs.writeFile(outside, MP3_HEADER);
    await fs.symlink(outside, path.join(root, 'archive/2026/09/link_0000.mp3'));
    expect(await resolveRecording(config, '2026/09/link_0000.mp3')).toBeNull();
    await fs.unlink(path.join(root, 'archive/2026/09/link_0000.mp3'));
  });
});

describe('listMonths and listMonth', () => {
  it('lists months that hold recordings, newest first', async () => {
    expect(await listMonths(config)).toEqual([
      { year: '2026', month: '10', count: 1 },
      { year: '2026', month: '09', count: 2 },
    ]);
  });

  it('lists a month with dates, durations from the index and a preview', async () => {
    const recs = await listMonth(config, '2026', '09');
    expect(recs.map((r) => r.name)).toEqual(['260920_2015_01.mp3', '260914_1030.mp3']);
    const first = recs.find((r) => r.name === '260914_1030.mp3');
    expect(first).toMatchObject({
      path: '2026/09/260914_1030.mp3',
      recordedAt: '2026-09-14T10:30:00.000Z',
      durationMs: 61000,
      hasTranscript: true,
      preview: 'Il notaio ha firmato. Sottotitoli a cura di QTSS',
    });
    const cont = recs.find((r) => r.name === '260920_2015_01.mp3');
    expect(cont).toMatchObject({ hasTranscript: false, preview: null, durationMs: null });
  });

  it('returns nothing for invalid or missing months', async () => {
    expect(await listMonth(config, '2026', '13')).toEqual([]);
    expect(await listMonth(config, '1999', '01')).toEqual([]);
  });
});

describe('searchLibrary', () => {
  it('runs FTS5 queries with operators and folds accents', async () => {
    const hits = await searchLibrary(config, 'perche AND notaio');
    expect(hits?.map((h) => h.path)).toEqual(['2026/09/260914_1030.mp3']);
    expect(hits?.[0].snippet).toContain('\u0002notaio\u0003');
    expect(await searchLibrary(config, 'notaio NOT firmato')).toEqual([]);
  });

  it('reports malformed queries as query errors', async () => {
    await expect(searchLibrary(config, '"unterminated')).rejects.toBeInstanceOf(LibraryQueryError);
  });
});

describe('readTranscript', () => {
  it('prefers the cleaned segments from the index', async () => {
    expect(await readTranscript(config, '2026/09/260914_1030.mp3')).toEqual({
      language: 'it',
      durationMs: 61000,
      segments: [{ s: 0, e: 4000, t: 'Il notaio ha firmato perché era pronto.' }],
    });
  });

  it('falls back to the whisper JSON when there is no index', async () => {
    const noIndex = { ...config, indexDb: path.join(root, 'missing.db') };
    expect(await readTranscript(noIndex, '2026/09/260914_1030.mp3')).toEqual({
      language: 'it',
      durationMs: 4500,
      segments: [
        { s: 0, e: 4000, t: 'Il notaio ha firmato.' },
        { s: 4000, e: 4500, t: 'Sottotitoli a cura di QTSS' },
      ],
    });
  });

  it('returns null when there is no transcript', async () => {
    expect(await readTranscript(config, '2026/09/260920_2015_01.mp3')).toBeNull();
  });
});

describe('parseWhisperJson', () => {
  it('skips malformed and empty segments', () => {
    expect(
      parseWhisperJson({
        transcription: [
          { offsets: { from: 0, to: 1000 }, text: '  hello ' },
          { offsets: { from: 1000 }, text: 'no end' },
          { offsets: { from: 2000, to: 3000 }, text: '   ' },
          'junk',
        ],
      })
    ).toEqual({ language: null, durationMs: 1000, segments: [{ s: 0, e: 1000, t: 'hello' }] });
    expect(parseWhisperJson(null)).toBeNull();
    expect(parseWhisperJson({ foo: 1 })).toBeNull();
  });
});
