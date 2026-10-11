import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resetPhotoStorageCache } from '@/lib/photo-storage';
import {
  isMp3Buffer,
  parseRecordingTimestamp,
  parseRangeHeader,
  sanitizeOriginalName,
  savePersonAudioFile,
  openPersonAudioFile,
  deletePersonAudioFiles,
  deletePersonAudioDir,
  getPersonAudioDir,
} from '@/lib/person-audio-storage';

const ID3_MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([0x04, 0x00, 0x00]), Buffer.alloc(100, 1)]);

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe('person-audio-storage', () => {
  describe('isMp3Buffer', () => {
    it('accepts an ID3 tag or an MPEG Layer III frame header', () => {
      expect(isMp3Buffer(ID3_MP3)).toBe(true);
      expect(isMp3Buffer(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe(true); // MPEG-1 Layer III
      expect(isMp3Buffer(Buffer.from([0xff, 0xf3, 0x90, 0x64]))).toBe(true); // MPEG-2 Layer III
    });

    it('rejects other files', () => {
      expect(isMp3Buffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false); // JPEG
      expect(isMp3Buffer(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toBe(false); // AAC ADTS
      expect(isMp3Buffer(Buffer.from('RIFF....WAVE'))).toBe(false);
      expect(isMp3Buffer(Buffer.from('ID'))).toBe(false);
    });
  });

  describe('parseRecordingTimestamp', () => {
    it('reads YYMMDD_HHMM as a UTC wall-clock time', () => {
      expect(parseRecordingTimestamp('241005_1430.mp3')?.toISOString()).toBe('2024-10-05T14:30:00.000Z');
      expect(parseRecordingTimestamp('991231_2359.MP3')?.toISOString()).toBe('2099-12-31T23:59:00.000Z');
    });

    it('allows text after the minutes', () => {
      expect(parseRecordingTimestamp('241005_1430 (2).mp3')?.toISOString()).toBe('2024-10-05T14:30:00.000Z');
      expect(parseRecordingTimestamp('241005_1430_call.mp3')?.toISOString()).toBe('2024-10-05T14:30:00.000Z');
    });

    it('returns null for other names and impossible dates', () => {
      expect(parseRecordingTimestamp('voice memo.mp3')).toBeNull();
      expect(parseRecordingTimestamp('241005_14301.mp3')).toBeNull();
      expect(parseRecordingTimestamp('241305_1430.mp3')).toBeNull();
      expect(parseRecordingTimestamp('240231_1430.mp3')).toBeNull();
      expect(parseRecordingTimestamp('241005_2460.mp3')).toBeNull();
      expect(parseRecordingTimestamp('241005_2400.mp3')).toBeNull();
    });
  });

  describe('parseRangeHeader', () => {
    it('parses single ranges', () => {
      expect(parseRangeHeader('bytes=0-99')).toEqual({ start: 0, end: 99 });
      expect(parseRangeHeader('bytes=100-')).toEqual({ start: 100, end: null });
      expect(parseRangeHeader('bytes=-50')).toEqual({ start: null, end: 50 });
    });

    it('ignores missing, malformed and multi-range headers', () => {
      expect(parseRangeHeader(null)).toBeUndefined();
      expect(parseRangeHeader('bytes=-')).toBeUndefined();
      expect(parseRangeHeader('bytes=0-1,5-6')).toBeUndefined();
      expect(parseRangeHeader('items=0-1')).toBeUndefined();
    });
  });

  it('sanitizes uploaded filenames', () => {
    expect(sanitizeOriginalName('C:\\Users\\me\\241005_1430.mp3')).toBe('241005_1430.mp3');
    expect(sanitizeOriginalName('a\u0000b.mp3')).toBe('ab.mp3');
    expect(sanitizeOriginalName('')).toBe('recording.mp3');
    expect(sanitizeOriginalName('x'.repeat(400)).length).toBe(255);
  });

  describe('files on disk', () => {
    let tmpDir: string;
    const originalEnv = process.env.PHOTO_STORAGE_PATH;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'person-audio-'));
      process.env.PHOTO_STORAGE_PATH = tmpDir;
      resetPhotoStorageCache();
    });

    afterEach(async () => {
      process.env.PHOTO_STORAGE_PATH = originalEnv;
      resetPhotoStorageCache();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('stores files in the person audio folder', async () => {
      const filename = await savePersonAudioFile('user1', 'person1', 'abc123', ID3_MP3);
      expect(filename).toBe('abc123.mp3');
      expect(getPersonAudioDir('user1', 'person1')).toBe(path.join(tmpDir, 'user1', 'audio', 'person1'));
      const stored = await fs.readFile(path.join(tmpDir, 'user1', 'audio', 'person1', filename));
      expect(stored.equals(ID3_MP3)).toBe(true);
    });

    it('rejects unsafe ids', async () => {
      await expect(savePersonAudioFile('user1', 'person1', '../x', ID3_MP3)).rejects.toThrow('Invalid audio id');
    });

    it('streams the whole file or a byte range', async () => {
      await savePersonAudioFile('user1', 'person1', 'abc', ID3_MP3);

      const whole = await openPersonAudioFile('user1', 'person1', 'abc.mp3');
      if (!whole || 'unsatisfiable' in whole) throw new Error('expected a stream');
      expect(whole.totalSize).toBe(ID3_MP3.length);
      expect((await readAll(whole.stream)).equals(ID3_MP3)).toBe(true);

      const part = await openPersonAudioFile('user1', 'person1', 'abc.mp3', { start: 2, end: 5 });
      if (!part || 'unsatisfiable' in part) throw new Error('expected a stream');
      expect([part.start, part.end]).toEqual([2, 5]);
      expect((await readAll(part.stream)).equals(ID3_MP3.subarray(2, 6))).toBe(true);

      const suffix = await openPersonAudioFile('user1', 'person1', 'abc.mp3', { start: null, end: 10 });
      if (!suffix || 'unsatisfiable' in suffix) throw new Error('expected a stream');
      expect((await readAll(suffix.stream)).equals(ID3_MP3.subarray(ID3_MP3.length - 10))).toBe(true);

      const open = await openPersonAudioFile('user1', 'person1', 'abc.mp3', { start: 50, end: null });
      if (!open || 'unsatisfiable' in open) throw new Error('expected a stream');
      expect(open.end).toBe(ID3_MP3.length - 1);
      await open.stream.cancel();

      const outside = await openPersonAudioFile('user1', 'person1', 'abc.mp3', { start: 1000, end: null });
      expect(outside).toEqual({ unsatisfiable: true, totalSize: ID3_MP3.length });
    });

    it('returns null for missing or unsafe filenames', async () => {
      expect(await openPersonAudioFile('user1', 'person1', 'missing.mp3')).toBeNull();
      expect(await openPersonAudioFile('user1', 'person1', '../secret.mp3')).toBeNull();
    });

    it('deletes single files and whole folders', async () => {
      await savePersonAudioFile('user1', 'person1', 'a', ID3_MP3);
      await savePersonAudioFile('user1', 'person1', 'b', ID3_MP3);

      await deletePersonAudioFiles('user1', 'person1', ['a.mp3', 'missing.mp3']);
      expect(await fs.readdir(getPersonAudioDir('user1', 'person1'))).toEqual(['b.mp3']);

      await deletePersonAudioDir('user1', 'person1');
      await expect(fs.stat(getPersonAudioDir('user1', 'person1'))).rejects.toThrow();
    });
  });
});
