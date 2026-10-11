import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface Row {
  id: string;
  personId: string;
  sha256: string | null;
  legacyFilename: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  createdAt: Date;
}

// Small in-memory stand-in for prisma.personDocument; person p1 and p2 belong
// to user1, p3 to user2.
const db = vi.hoisted(() => ({ rows: [] as Row[], owners: { p1: 'user1', p2: 'user1', p3: 'user2' } as Record<string, string>, nextId: 1 }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'person') return db.owners[row.personId] === (value as { userId: string }).userId;
    if (value && typeof value === 'object' && 'not' in value) return row[key as keyof Row] !== (value as { not: unknown }).not;
    return row[key as keyof Row] === value;
  });
}

vi.mock('../../lib/prisma', () => ({
  prisma: {
    personDocument: {
      findFirst: vi.fn(async ({ where }) => db.rows.find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where }) =>
        db.rows.filter((r) => matches(r, where)).map((r) => ({ ...r, person: { userId: db.owners[r.personId] } }))
      ),
      count: vi.fn(async ({ where }) => db.rows.filter((r) => matches(r, where)).length),
      create: vi.fn(async ({ data }) => {
        const row: Row = { id: `d${db.nextId++}`, legacyFilename: null, createdAt: new Date(), ...data };
        db.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = db.rows.find((r) => r.id === where.id) as Row;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }) => {
        db.rows = db.rows.filter((r) => r.id !== where.id);
      }),
      deleteMany: vi.fn(async ({ where }) => {
        db.rows = db.rows.filter((r) => !matches(r, where));
      }),
    },
  },
}));

import { resetPhotoStorageCache } from '@/lib/photo-storage';
import { getLegacyGalleryDir, sha256Hex } from '@/lib/person-document-storage';
import {
  addPersonDocument,
  migrateLegacyImages,
  removeAllPersonDocuments,
  removePersonDocument,
} from '@/lib/person-documents';

const PDF = Buffer.from('%PDF-1.4\nsome document');

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(() => true, () => false);
}

describe('person documents', () => {
  let tmpDir: string;
  const originalEnv = process.env.PHOTO_STORAGE_PATH;
  const blobPath = (userId: string, data: Buffer) => {
    const sha = sha256Hex(data);
    return path.join(tmpDir, userId, 'documents', sha.slice(0, 2), sha);
  };

  beforeEach(async () => {
    db.rows = [];
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'person-documents-svc-'));
    process.env.PHOTO_STORAGE_PATH = tmpDir;
    resetPhotoStorageCache();
  });

  afterEach(async () => {
    process.env.PHOTO_STORAGE_PATH = originalEnv;
    resetPhotoStorageCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores the same file once and returns the existing entry for a repeat upload', async () => {
    const first = await addPersonDocument('user1', 'p1', PDF, 'scan.pdf', 'application/pdf');
    expect(first.duplicate).toBe(false);
    expect(first.document).toMatchObject({ originalName: 'scan.pdf', mimeType: 'application/pdf', size: PDF.length, hasThumbnail: false });

    const again = await addPersonDocument('user1', 'p1', PDF, 'copy.pdf', 'application/pdf');
    expect(again.duplicate).toBe(true);
    expect(again.document.id).toBe(first.document.id);

    const other = await addPersonDocument('user1', 'p2', PDF, 'scan.pdf', 'application/pdf');
    expect(other.duplicate).toBe(false);
    expect(db.rows).toHaveLength(2);
    expect(await exists(blobPath('user1', PDF))).toBe(true);
  });

  it('keeps a shared file until the last entry using it is deleted', async () => {
    const a = await addPersonDocument('user1', 'p1', PDF, 'a.pdf', '');
    const b = await addPersonDocument('user1', 'p2', PDF, 'b.pdf', '');
    const rowOf = (id: string) => db.rows.find((r) => r.id === id) as Row;

    await removePersonDocument('user1', rowOf(a.document.id));
    expect(await exists(blobPath('user1', PDF))).toBe(true);

    await removePersonDocument('user1', rowOf(b.document.id));
    expect(await exists(blobPath('user1', PDF))).toBe(false);
    expect(db.rows).toHaveLength(0);
  });

  it('keeps each account\'s files apart', async () => {
    await addPersonDocument('user1', 'p1', PDF, 'a.pdf', '');
    await addPersonDocument('user2', 'p3', PDF, 'a.pdf', '');
    await removeAllPersonDocuments('user2', 'p3');
    expect(await exists(blobPath('user2', PDF))).toBe(false);
    expect(await exists(blobPath('user1', PDF))).toBe(true);
  });

  it('removes all of a person\'s documents and the files nobody else uses', async () => {
    const other = Buffer.from('%PDF-1.4\nonly p1');
    await addPersonDocument('user1', 'p1', PDF, 'a.pdf', '');
    await addPersonDocument('user1', 'p1', other, 'b.pdf', '');
    await addPersonDocument('user1', 'p2', PDF, 'a.pdf', '');

    await removeAllPersonDocuments('user1', 'p1');
    expect(db.rows.map((r) => r.personId)).toEqual(['p2']);
    expect(await exists(blobPath('user1', PDF))).toBe(true);
    expect(await exists(blobPath('user1', other))).toBe(false);
  });

  it('moves old image folder files into the hashed store', async () => {
    const dir = getLegacyGalleryDir('user1', 'p1');
    await fs.mkdir(dir, { recursive: true });
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await fs.writeFile(path.join(dir, 'img1.jpg'), image);
    await fs.writeFile(path.join(dir, 'img1_thumb.jpg'), Buffer.from([0xff, 0xd8, 0xff, 9]));
    const base = { originalName: 'image.jpg', mimeType: 'image/jpeg', width: 1, height: 1, hasThumbnail: true, createdAt: new Date() };
    db.rows.push(
      { ...base, id: 'img1', personId: 'p1', sha256: null, legacyFilename: 'img1.jpg', size: 0 },
      { ...base, id: 'gone', personId: 'p1', sha256: null, legacyFilename: 'gone.jpg', size: 0 }
    );

    const result = await migrateLegacyImages();
    expect(result).toEqual({ moved: 1, missing: 1 });

    const moved = db.rows.find((r) => r.id === 'img1') as Row;
    expect(moved.sha256).toBe(sha256Hex(image));
    expect(moved.legacyFilename).toBeNull();
    expect(moved.size).toBe(image.length);
    expect(await fs.readFile(blobPath('user1', image))).toEqual(image);
    expect(await exists(`${blobPath('user1', image)}.thumb`)).toBe(true);
    expect(await exists(path.join(tmpDir, 'user1', 'gallery'))).toBe(false);

    // The entry whose file is missing is left as it was, and a rerun is harmless
    expect((db.rows.find((r) => r.id === 'gone') as Row).legacyFilename).toBe('gone.jpg');
    expect(await migrateLegacyImages()).toEqual({ moved: 0, missing: 1 });
  });
});
