import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { resetPhotoStorageCache } from '@/lib/photo-storage';
import { deleteUserFiles } from '@/lib/person-files';

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

describe('deleteUserFiles', () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'nametag-user-files-'));
    process.env.PHOTO_STORAGE_PATH = base;
    resetPhotoStorageCache();
  });

  afterEach(async () => {
    delete process.env.PHOTO_STORAGE_PATH;
    resetPhotoStorageCache();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("removes the user's folder and leaves other users alone", async () => {
    await fs.mkdir(path.join(base, 'user1', 'documents', 'ab'), { recursive: true });
    await fs.writeFile(path.join(base, 'user1', 'documents', 'ab', 'file'), 'x');
    await fs.mkdir(path.join(base, 'user2'), { recursive: true });
    await fs.writeFile(path.join(base, 'user2', 'p1.jpg'), 'x');

    await deleteUserFiles('user1');

    expect(await exists(path.join(base, 'user1'))).toBe(false);
    expect(await exists(path.join(base, 'user2', 'p1.jpg'))).toBe(true);
  });

  it('does nothing when the user has no folder', async () => {
    await expect(deleteUserFiles('nobody')).resolves.toBeUndefined();
    expect(await exists(base)).toBe(true);
  });

  it('never removes the storage root or anything outside it', async () => {
    await fs.mkdir(path.join(base, 'user2'), { recursive: true });
    for (const id of ['', '.', '..', '../x', 'a/b']) {
      await deleteUserFiles(id);
    }
    expect(await exists(path.join(base, 'user2'))).toBe(true);
  });
});
