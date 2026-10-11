import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resetPhotoStorageCache } from '@/lib/photo-storage';
import {
  deleteDocumentBlob,
  deleteLegacyImage,
  detectMimeType,
  getDocumentStoreDir,
  getLegacyGalleryDir,
  makeThumbnail,
  openDocumentFile,
  readDocumentThumbnail,
  readLegacyImage,
  sanitizeOriginalName,
  sha256Hex,
  storeDocumentBlob,
  withBlobLock,
} from '@/lib/person-document-storage';

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function ftyp(brand: string): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(8)]);
}

describe('person-document-storage', () => {
  let tmpDir: string;
  const originalEnv = process.env.PHOTO_STORAGE_PATH;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'person-documents-'));
    process.env.PHOTO_STORAGE_PATH = tmpDir;
    resetPhotoStorageCache();
  });

  afterEach(async () => {
    process.env.PHOTO_STORAGE_PATH = originalEnv;
    resetPhotoStorageCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('detectMimeType', () => {
    it('recognises common formats by their first bytes', () => {
      expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '')).toBe('image/jpeg');
      expect(detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), '')).toBe('image/png');
      expect(detectMimeType(Buffer.from('GIF89a...'), '')).toBe('image/gif');
      expect(detectMimeType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), '')).toBe('image/webp');
      expect(detectMimeType(Buffer.from('%PDF-1.7\n'), 'application/octet-stream')).toBe('application/pdf');
      expect(detectMimeType(ftyp('isom'), '')).toBe('video/mp4');
      expect(detectMimeType(ftyp('qt  '), '')).toBe('video/quicktime');
      expect(detectMimeType(ftyp('heic'), '')).toBe('image/heic');
      expect(detectMimeType(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('....webm')]), '')).toBe('video/webm');
      expect(detectMimeType(Buffer.from('ID3\x04\0'), '')).toBe('audio/mpeg');
    });

    it('uses the browser type only for formats it does not recognise', () => {
      expect(detectMimeType(Buffer.from('PK\x03\x04'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
        .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(detectMimeType(Buffer.from('hello'), 'text/plain')).toBe('text/plain');
      expect(detectMimeType(Buffer.from('hello'), 'text/html')).toBe('text/html');
    });

    it('does not let a file claim to be an image, video or PDF', () => {
      expect(detectMimeType(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBe('application/octet-stream');
      expect(detectMimeType(Buffer.from('<html>'), 'application/pdf')).toBe('application/octet-stream');
      expect(detectMimeType(Buffer.from('<svg/>'), 'image/svg+xml')).toBe('application/octet-stream');
      expect(detectMimeType(Buffer.from([0x00, 0x01, 0x02]), 'text/plain')).toBe('application/octet-stream');
      expect(detectMimeType(Buffer.from('x'), 'not a type')).toBe('application/octet-stream');
    });
  });

  it('keeps only the last path segment of uploaded names', () => {
    expect(sanitizeOriginalName('C:\\Users\\me\\scan.pdf')).toBe('scan.pdf');
    expect(sanitizeOriginalName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalName('a\u0000b.txt')).toBe('ab.txt');
    expect(sanitizeOriginalName('')).toBe('file');
  });

  describe('makeThumbnail', () => {
    it('builds a 400px thumbnail for images and reports the size', async () => {
      const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c86432' } }).jpeg().toBuffer();
      const thumb = await makeThumbnail(jpeg, 'image/jpeg');
      expect(thumb).not.toBeNull();
      expect(thumb?.width).toBe(1200);
      expect(thumb?.height).toBe(800);
      const meta = await sharp(thumb?.thumbnail).metadata();
      expect(meta.width).toBe(400);
      expect(meta.format).toBe('jpeg');
    });

    it('keeps transparent thumbnails as PNG', async () => {
      const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const thumb = await makeThumbnail(png, 'image/png');
      expect((await sharp(thumb?.thumbnail).metadata()).format).toBe('png');
    });

    it('returns null for other files and unreadable images', async () => {
      expect(await makeThumbnail(Buffer.from('%PDF-1.4'), 'application/pdf')).toBeNull();
      expect(await makeThumbnail(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBeNull();
    });
  });

  describe('blob store', () => {
    it('stores files under their hash, once, and serves byte ranges', async () => {
      const data = Buffer.from('0123456789');
      const sha = sha256Hex(data);
      await storeDocumentBlob('user1', sha, data, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const blobPath = path.join(getDocumentStoreDir('user1'), sha.slice(0, 2), sha);
      expect(blobPath).toBe(path.join(tmpDir, 'user1', 'documents', sha.slice(0, 2), sha));
      expect(await fs.readFile(blobPath)).toEqual(data);
      const firstWrite = (await fs.stat(blobPath)).mtimeMs;

      // Same bytes again: nothing is rewritten
      await new Promise((r) => setTimeout(r, 20));
      await storeDocumentBlob('user1', sha, data, null);
      expect((await fs.stat(blobPath)).mtimeMs).toBe(firstWrite);

      const whole = await openDocumentFile('user1', { kind: 'blob', sha256: sha });
      expect(whole && 'stream' in whole && (await readStream(whole.stream)).toString()).toBe('0123456789');
      const part = await openDocumentFile('user1', { kind: 'blob', sha256: sha }, { start: 2, end: 4 });
      expect(part && 'stream' in part && (await readStream(part.stream)).toString()).toBe('234');
      const outside = await openDocumentFile('user1', { kind: 'blob', sha256: sha }, { start: 50, end: null });
      expect(outside).toEqual({ unsatisfiable: true, totalSize: 10 });

      const thumb = await readDocumentThumbnail('user1', { kind: 'blob', sha256: sha });
      expect(thumb?.mimeType).toBe('image/png');

      await deleteDocumentBlob('user1', sha);
      expect(await openDocumentFile('user1', { kind: 'blob', sha256: sha })).toBeNull();
      expect(await readDocumentThumbnail('user1', { kind: 'blob', sha256: sha })).toBeNull();
      // Empty shard directory is removed too
      await expect(fs.stat(path.dirname(blobPath))).rejects.toThrow();
    });

    it('rejects anything that is not a SHA-256 hash', async () => {
      await expect(storeDocumentBlob('user1', '../../escape', Buffer.from('x'), null)).rejects.toThrow('Invalid document hash');
      await expect(openDocumentFile('user1', { kind: 'blob', sha256: 'ABC' })).rejects.toThrow('Invalid document hash');
    });

    it('rejects user ids that escape the storage directory', () => {
      expect(() => getDocumentStoreDir('../../etc')).toThrow();
    });

    it('runs work on the same blob one at a time', async () => {
      const order: string[] = [];
      const slow = withBlobLock('u', 'a'.repeat(64), async () => {
        order.push('start1');
        await new Promise((r) => setTimeout(r, 20));
        order.push('end1');
      });
      const fast = withBlobLock('u', 'a'.repeat(64), async () => {
        order.push('start2');
      });
      await Promise.all([slow, fast]);
      expect(order).toEqual(['start1', 'end1', 'start2']);
    });
  });

  describe('old image folder', () => {
    it('reads and serves files from the old layout, then removes them', async () => {
      const dir = getLegacyGalleryDir('user1', 'person1');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'abc.jpg'), 'full');
      await fs.writeFile(path.join(dir, 'abc_thumb.jpg'), Buffer.from([0xff, 0xd8, 0xff]));

      const legacy = await readLegacyImage('user1', 'person1', 'abc.jpg');
      expect(legacy?.data.toString()).toBe('full');
      expect(legacy?.thumbnail).not.toBeNull();

      const location = { kind: 'legacy' as const, personId: 'person1', legacyFilename: 'abc.jpg' };
      const served = await openDocumentFile('user1', location);
      expect(served && 'stream' in served && (await readStream(served.stream)).toString()).toBe('full');
      expect((await readDocumentThumbnail('user1', location))?.mimeType).toBe('image/jpeg');

      await deleteLegacyImage('user1', 'person1', 'abc.jpg');
      await expect(fs.stat(path.join(tmpDir, 'user1', 'gallery'))).rejects.toThrow();
    });

    it('ignores names the old folder never produced', async () => {
      expect(await readLegacyImage('user1', 'person1', '../secret.jpg')).toBeNull();
      expect(await openDocumentFile('user1', { kind: 'legacy', personId: 'person1', legacyFilename: 'x.pdf' })).toBeNull();
    });
  });
});
