// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  docFindMany: vi.fn(),
  docFindFirst: vi.fn(),
  docCount: vi.fn(),
  addPersonDocument: vi.fn(),
  removePersonDocument: vi.fn(),
  openDocumentFile: vi.fn(),
  readDocumentThumbnail: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    person: { findUnique: mocks.personFindUnique },
    personDocument: {
      findMany: mocks.docFindMany,
      findFirst: mocks.docFindFirst,
      count: mocks.docCount,
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

vi.mock('../../lib/person-documents', () => ({
  documentSelect: { id: true },
  addPersonDocument: mocks.addPersonDocument,
  removePersonDocument: mocks.removePersonDocument,
}));

vi.mock('../../lib/person-document-storage', () => ({
  MAX_PERSON_DOCUMENTS: 1000,
  MAX_PERSON_DOCUMENT_UPLOAD_SIZE: 200 * 1024 * 1024,
  openDocumentFile: mocks.openDocumentFile,
  readDocumentThumbnail: mocks.readDocumentThumbnail,
}));

import { GET as LIST, POST } from '../../app/api/people/[id]/documents/route';
import { GET as SERVE, DELETE } from '../../app/api/people/[id]/documents/[documentId]/route';

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

function uploadRequest(personId: string, file?: Blob, name = 'scan.pdf') {
  const formData = new FormData();
  if (file) formData.append('file', new File([file], name, { type: file.type }));
  return new Request(`http://localhost/api/people/${personId}/documents`, { method: 'POST', body: formData });
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

const storedDoc = {
  id: 'd1',
  personId: 'p1',
  sha256: 'a'.repeat(64),
  legacyFilename: null,
  originalName: 'scan.pdf',
  mimeType: 'application/pdf',
  hasThumbnail: false,
};

describe('Person document folder API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.docCount.mockResolvedValue(0);
  });

  describe('GET /api/people/[id]/documents', () => {
    it('lists documents for an owned person', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.docFindMany.mockResolvedValue([{ id: 'd1' }]);

      const res = await LIST(new Request('http://localhost/api/people/p1/documents'), ctx({ id: 'p1' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.documents).toHaveLength(1);
      expect(mocks.personFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', userId: 'user-123', deletedAt: null } })
      );
    });

    it('returns 404 for a person the user does not own', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await LIST(new Request('http://localhost/api/people/p1/documents'), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.docFindMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/people/[id]/documents', () => {
    it('stores an upload with its name and browser type', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.addPersonDocument.mockResolvedValue({ document: { id: 'd1' }, duplicate: false });

      const res = await POST(uploadRequest('p1', new Blob(['%PDF-1.4'], { type: 'application/pdf' })), ctx({ id: 'p1' }));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ document: { id: 'd1' }, duplicate: false });
      expect(mocks.addPersonDocument).toHaveBeenCalledWith('user-123', 'p1', Buffer.from('%PDF-1.4'), 'scan.pdf', 'application/pdf');
    });

    it('answers 200 with duplicate: true when the person already has the file', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.addPersonDocument.mockResolvedValue({ document: { id: 'd1' }, duplicate: true });
      const res = await POST(uploadRequest('p1', new Blob(['x'])), ctx({ id: 'p1' }));
      expect(res.status).toBe(200);
      expect((await res.json()).duplicate).toBe(true);
    });

    it('rejects missing and empty files', async () => {
      expect((await POST(uploadRequest('p1'), ctx({ id: 'p1' }))).status).toBe(400);
      expect((await POST(uploadRequest('p1', new Blob([])), ctx({ id: 'p1' }))).status).toBe(400);
    });

    it('returns 404 when the person is not owned', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await POST(uploadRequest('p1', new Blob(['x'])), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.addPersonDocument).not.toHaveBeenCalled();
    });

    it('rejects uploads once the folder is full', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.docCount.mockResolvedValue(1000);
      const res = await POST(uploadRequest('p1', new Blob(['x'])), ctx({ id: 'p1' }));
      expect(res.status).toBe(400);
      expect(mocks.addPersonDocument).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/people/[id]/documents/[documentId]', () => {
    const serve = (query = '', headers: Record<string, string> = {}) =>
      SERVE(new Request(`http://localhost/api/people/p1/documents/d1${query}`, { headers }), ctx({ id: 'p1', documentId: 'd1' }));

    it('serves PDFs inline', async () => {
      mocks.docFindFirst.mockResolvedValue(storedDoc);
      mocks.openDocumentFile.mockResolvedValue({ stream: streamOf(Buffer.from('%PDF')), start: 0, end: 3, totalSize: 4 });

      const res = await serve();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toContain('inline; filename="scan.pdf"');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(mocks.openDocumentFile).toHaveBeenCalledWith('user-123', { kind: 'blob', sha256: storedDoc.sha256 }, undefined);
      expect(mocks.docFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'd1', personId: 'p1', person: { userId: 'user-123', deletedAt: null } },
      }));
    });

    it('serves other types as downloads', async () => {
      mocks.docFindFirst.mockResolvedValue({ ...storedDoc, originalName: 'page.html', mimeType: 'text/html' });
      mocks.openDocumentFile.mockResolvedValue({ stream: streamOf(Buffer.from('<p>')), start: 0, end: 2, totalSize: 3 });

      const res = await serve();
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
    });

    it('serves a download when asked', async () => {
      mocks.docFindFirst.mockResolvedValue(storedDoc);
      mocks.openDocumentFile.mockResolvedValue({ stream: streamOf(Buffer.from('%PDF')), start: 0, end: 3, totalSize: 4 });
      const res = await serve('?download=1');
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
    });

    it('answers Range requests with 206 and 416', async () => {
      mocks.docFindFirst.mockResolvedValue({ ...storedDoc, mimeType: 'video/mp4', originalName: 'clip.mp4' });
      mocks.openDocumentFile.mockResolvedValue({ stream: streamOf(Buffer.from('ab')), start: 2, end: 3, totalSize: 10 });
      const part = await serve('', { range: 'bytes=2-3' });
      expect(part.status).toBe(206);
      expect(part.headers.get('Content-Range')).toBe('bytes 2-3/10');
      expect(part.headers.get('Content-Length')).toBe('2');
      expect(mocks.openDocumentFile).toHaveBeenLastCalledWith('user-123', expect.anything(), { start: 2, end: 3 });

      mocks.openDocumentFile.mockResolvedValue({ unsatisfiable: true, totalSize: 10 });
      const outside = await serve('', { range: 'bytes=50-' });
      expect(outside.status).toBe(416);
    });

    it('serves thumbnails, and 404 when there is none', async () => {
      mocks.docFindFirst.mockResolvedValue({ ...storedDoc, mimeType: 'image/jpeg', hasThumbnail: true });
      mocks.readDocumentThumbnail.mockResolvedValue({ buffer: Buffer.from([0xff, 0xd8]), mimeType: 'image/jpeg' });
      const thumb = await serve('?size=thumb');
      expect(thumb.status).toBe(200);
      expect(thumb.headers.get('Content-Type')).toBe('image/jpeg');

      mocks.docFindFirst.mockResolvedValue(storedDoc);
      expect((await serve('?size=thumb')).status).toBe(404);
    });

    it('serves images that are still in the old image folder', async () => {
      mocks.docFindFirst.mockResolvedValue({ ...storedDoc, sha256: null, legacyFilename: 'd1.jpg', mimeType: 'image/jpeg' });
      mocks.openDocumentFile.mockResolvedValue({ stream: streamOf(Buffer.from('x')), start: 0, end: 0, totalSize: 1 });
      await serve();
      expect(mocks.openDocumentFile).toHaveBeenCalledWith(
        'user-123',
        { kind: 'legacy', personId: 'p1', legacyFilename: 'd1.jpg' },
        undefined
      );
    });

    it('returns 404 for an unknown document or a missing file', async () => {
      mocks.docFindFirst.mockResolvedValue(null);
      expect((await serve()).status).toBe(404);
      mocks.docFindFirst.mockResolvedValue(storedDoc);
      mocks.openDocumentFile.mockResolvedValue(null);
      expect((await serve()).status).toBe(404);
    });
  });

  describe('DELETE /api/people/[id]/documents/[documentId]', () => {
    const del = () =>
      DELETE(
        new Request('http://localhost/api/people/p1/documents/d1', { method: 'DELETE' }),
        ctx({ id: 'p1', documentId: 'd1' })
      );

    it('removes the document', async () => {
      mocks.docFindFirst.mockResolvedValue(storedDoc);
      const res = await del();
      expect(res.status).toBe(200);
      expect(mocks.removePersonDocument).toHaveBeenCalledWith('user-123', storedDoc);
    });

    it('returns 404 when the document is not found', async () => {
      mocks.docFindFirst.mockResolvedValue(null);
      expect((await del()).status).toBe(404);
      expect(mocks.removePersonDocument).not.toHaveBeenCalled();
    });
  });
});
