import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  imageFindMany: vi.fn(),
  imageFindFirst: vi.fn(),
  imageCount: vi.fn(),
  imageCreate: vi.fn(),
  imageDelete: vi.fn(),
  processPersonImage: vi.fn(),
  savePersonImageFiles: vi.fn(),
  readPersonImageFile: vi.fn(),
  deletePersonImageFiles: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    person: { findUnique: mocks.personFindUnique },
    personImage: {
      findMany: mocks.imageFindMany,
      findFirst: mocks.imageFindFirst,
      count: mocks.imageCount,
      create: mocks.imageCreate,
      delete: mocks.imageDelete,
    },
  },
}));

vi.mock('../../lib/auth', () => ({
  auth: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-123', email: 'test@example.com', name: 'Test' },
    })
  ),
}));

vi.mock('../../lib/person-image-storage', () => ({
  MAX_PERSON_IMAGES: 500,
  MAX_PERSON_IMAGE_UPLOAD_SIZE: 50 * 1024 * 1024,
  processPersonImage: mocks.processPersonImage,
  savePersonImageFiles: mocks.savePersonImageFiles,
  readPersonImageFile: mocks.readPersonImageFile,
  deletePersonImageFiles: mocks.deletePersonImageFiles,
}));

import { GET as LIST, POST } from '../../app/api/people/[id]/images/route';
import { GET as SERVE, DELETE } from '../../app/api/people/[id]/images/[imageId]/route';

const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

function uploadRequest(personId: string, file?: Blob) {
  const formData = new FormData();
  if (file) formData.append('image', file);
  return new Request(`http://localhost/api/people/${personId}/images`, { method: 'POST', body: formData });
}

describe('Person image folder API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imageCount.mockResolvedValue(0);
    mocks.processPersonImage.mockResolvedValue({
      full: Buffer.from('full'),
      thumbnail: Buffer.from('thumb'),
      ext: 'jpg',
      width: 800,
      height: 600,
    });
    mocks.savePersonImageFiles.mockImplementation(
      async (_u: string, _p: string, imageId: string) => ({ filename: `${imageId}.jpg`, thumbnail: `${imageId}_thumb.jpg` })
    );
  });

  describe('GET /api/people/[id]/images', () => {
    it('lists images for an owned person', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.imageFindMany.mockResolvedValue([{ id: 'i1', width: 1, height: 1, size: 10, createdAt: new Date() }]);

      const res = await LIST(new Request('http://localhost/api/people/p1/images'), ctx({ id: 'p1' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.images).toHaveLength(1);
      expect(mocks.personFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', userId: 'user-123', deletedAt: null } })
      );
      expect(mocks.imageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { personId: 'p1' } }));
    });

    it('returns 404 for a person the user does not own', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await LIST(new Request('http://localhost/api/people/p1/images'), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.imageFindMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/people/[id]/images', () => {
    it('processes, stores and records an upload', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.imageCreate.mockImplementation(async ({ data }: { data: { id: string } }) => ({
        id: data.id, width: 800, height: 600, size: 4, createdAt: new Date(),
      }));

      const res = await POST(uploadRequest('p1', new Blob([JPEG_HEADER], { type: 'image/jpeg' })), ctx({ id: 'p1' }));
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.image.width).toBe(800);
      expect(mocks.savePersonImageFiles).toHaveBeenCalledWith('user-123', 'p1', expect.stringMatching(/^[a-f0-9]{24}$/), expect.anything());
      const created = mocks.imageCreate.mock.calls[0][0].data;
      expect(created.filename).toBe(`${created.id}.jpg`);
      expect(created.thumbnail).toBe(`${created.id}_thumb.jpg`);
      expect(created.personId).toBe('p1');
    });

    it('rejects a request without a file', async () => {
      const res = await POST(uploadRequest('p1'), ctx({ id: 'p1' }));
      expect(res.status).toBe(400);
    });

    it('returns 404 when the person is not owned', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await POST(uploadRequest('p1', new Blob([JPEG_HEADER])), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.savePersonImageFiles).not.toHaveBeenCalled();
    });

    it('rejects uploads once the folder is full', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.imageCount.mockResolvedValue(500);
      const res = await POST(uploadRequest('p1', new Blob([JPEG_HEADER])), ctx({ id: 'p1' }));
      expect(res.status).toBe(400);
      expect(mocks.processPersonImage).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid images', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.processPersonImage.mockRejectedValue(new Error('Unsupported image format. Supported: JPEG, PNG, GIF, WebP'));
      const res = await POST(uploadRequest('p1', new Blob(['nope'])), ctx({ id: 'p1' }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('Unsupported image format');
    });

    it('removes written files when the database insert fails', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.imageCreate.mockRejectedValue(new Error('db down'));
      const res = await POST(uploadRequest('p1', new Blob([JPEG_HEADER])), ctx({ id: 'p1' }));
      expect(res.status).toBe(500);
      expect(mocks.deletePersonImageFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/people/[id]/images/[imageId]', () => {
    it('serves the full image or the thumbnail', async () => {
      mocks.imageFindFirst.mockResolvedValue({ id: 'i1', filename: 'i1.jpg', thumbnail: 'i1_thumb.jpg' });
      mocks.readPersonImageFile.mockResolvedValue({ buffer: Buffer.from('data'), mimeType: 'image/jpeg' });

      const full = await SERVE(new Request('http://localhost/api/people/p1/images/i1'), ctx({ id: 'p1', imageId: 'i1' }));
      expect(full.status).toBe(200);
      expect(full.headers.get('Content-Type')).toBe('image/jpeg');
      expect(mocks.readPersonImageFile).toHaveBeenLastCalledWith('user-123', 'p1', 'i1.jpg');

      await SERVE(new Request('http://localhost/api/people/p1/images/i1?size=thumb'), ctx({ id: 'p1', imageId: 'i1' }));
      expect(mocks.readPersonImageFile).toHaveBeenLastCalledWith('user-123', 'p1', 'i1_thumb.jpg');

      expect(mocks.imageFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'i1', personId: 'p1', person: { userId: 'user-123', deletedAt: null } },
      }));
    });

    it('returns 404 for an unknown image', async () => {
      mocks.imageFindFirst.mockResolvedValue(null);
      const res = await SERVE(new Request('http://localhost/api/people/p1/images/x'), ctx({ id: 'p1', imageId: 'x' }));
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/people/[id]/images/[imageId]', () => {
    it('deletes the record and its files', async () => {
      mocks.imageFindFirst.mockResolvedValue({ id: 'i1', filename: 'i1.jpg', thumbnail: 'i1_thumb.jpg' });
      mocks.imageDelete.mockResolvedValue({});

      const res = await DELETE(
        new Request('http://localhost/api/people/p1/images/i1', { method: 'DELETE' }),
        ctx({ id: 'p1', imageId: 'i1' })
      );

      expect(res.status).toBe(200);
      expect(mocks.imageDelete).toHaveBeenCalledWith({ where: { id: 'i1' } });
      expect(mocks.deletePersonImageFiles).toHaveBeenCalledWith('user-123', 'p1', ['i1.jpg', 'i1_thumb.jpg']);
    });

    it('returns 404 when the image is not found', async () => {
      mocks.imageFindFirst.mockResolvedValue(null);
      const res = await DELETE(
        new Request('http://localhost/api/people/p1/images/i1', { method: 'DELETE' }),
        ctx({ id: 'p1', imageId: 'i1' })
      );
      expect(res.status).toBe(404);
      expect(mocks.imageDelete).not.toHaveBeenCalled();
    });
  });
});
