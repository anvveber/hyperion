// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  audioFindMany: vi.fn(),
  audioFindFirst: vi.fn(),
  audioCount: vi.fn(),
  audioCreate: vi.fn(),
  audioDelete: vi.fn(),
  savePersonAudioFile: vi.fn(),
  openPersonAudioFile: vi.fn(),
  deletePersonAudioFiles: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: {
    person: { findUnique: mocks.personFindUnique },
    personAudio: {
      findMany: mocks.audioFindMany,
      findFirst: mocks.audioFindFirst,
      count: mocks.audioCount,
      create: mocks.audioCreate,
      delete: mocks.audioDelete,
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

vi.mock('../../lib/person-audio-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/person-audio-storage')>();
  return {
    ...actual,
    savePersonAudioFile: mocks.savePersonAudioFile,
    openPersonAudioFile: mocks.openPersonAudioFile,
    deletePersonAudioFiles: mocks.deletePersonAudioFiles,
  };
});

import { GET as LIST, POST } from '../../app/api/people/[id]/audio/route';
import { GET as SERVE, DELETE } from '../../app/api/people/[id]/audio/[audioId]/route';

const MP3_BYTES = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

function uploadRequest(personId: string, file?: Blob, name = '241005_1430.mp3') {
  const formData = new FormData();
  if (file) formData.append('audio', new File([file], name));
  return new Request(`http://localhost/api/people/${personId}/audio`, { method: 'POST', body: formData });
}

function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('Person audio folder API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audioCount.mockResolvedValue(0);
    mocks.savePersonAudioFile.mockImplementation(async (_u: string, _p: string, audioId: string) => `${audioId}.mp3`);
  });

  describe('GET /api/people/[id]/audio', () => {
    it('lists recordings newest first with undated ones last', async () => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.audioFindMany.mockResolvedValue([]);

      const res = await LIST(new Request('http://localhost/api/people/p1/audio'), ctx({ id: 'p1' }));
      expect(res.status).toBe(200);
      expect(mocks.personFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', userId: 'user-123', deletedAt: null } })
      );
      expect(mocks.audioFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { personId: 'p1' },
        orderBy: [{ recordedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }));
    });

    it('returns 404 for a person the user does not own', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await LIST(new Request('http://localhost/api/people/p1/audio'), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.audioFindMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/people/[id]/audio', () => {
    beforeEach(() => {
      mocks.personFindUnique.mockResolvedValue({ id: 'p1' });
      mocks.audioCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: data.id, originalName: data.originalName, recordedAt: data.recordedAt, size: data.size, createdAt: new Date(),
      }));
    });

    it('stores the file and reads the date from its name', async () => {
      const res = await POST(uploadRequest('p1', new Blob([MP3_BYTES], { type: 'audio/mpeg' })), ctx({ id: 'p1' }));
      expect(res.status).toBe(201);

      expect(mocks.savePersonAudioFile).toHaveBeenCalledWith('user-123', 'p1', expect.stringMatching(/^[a-f0-9]{24}$/), expect.any(Buffer));
      const created = mocks.audioCreate.mock.calls[0][0].data;
      expect(created.filename).toBe(`${created.id}.mp3`);
      expect(created.originalName).toBe('241005_1430.mp3');
      expect(created.recordedAt.toISOString()).toBe('2024-10-05T14:30:00.000Z');
      expect(created.size).toBe(MP3_BYTES.length);
    });

    it('accepts files without a date in the name', async () => {
      const res = await POST(uploadRequest('p1', new Blob([MP3_BYTES]), 'voice memo.mp3'), ctx({ id: 'p1' }));
      expect(res.status).toBe(201);
      expect(mocks.audioCreate.mock.calls[0][0].data.recordedAt).toBeNull();
    });

    it('rejects files that are not MP3', async () => {
      const res = await POST(uploadRequest('p1', new Blob([Buffer.from('RIFF0000WAVE')]), 'a.mp3'), ctx({ id: 'p1' }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('Only MP3');
      expect(mocks.savePersonAudioFile).not.toHaveBeenCalled();
    });

    it('rejects a request without a file', async () => {
      const res = await POST(uploadRequest('p1'), ctx({ id: 'p1' }));
      expect(res.status).toBe(400);
    });

    it('returns 404 when the person is not owned', async () => {
      mocks.personFindUnique.mockResolvedValue(null);
      const res = await POST(uploadRequest('p1', new Blob([MP3_BYTES])), ctx({ id: 'p1' }));
      expect(res.status).toBe(404);
      expect(mocks.savePersonAudioFile).not.toHaveBeenCalled();
    });

    it('rejects uploads once the folder is full', async () => {
      mocks.audioCount.mockResolvedValue(1000);
      const res = await POST(uploadRequest('p1', new Blob([MP3_BYTES])), ctx({ id: 'p1' }));
      expect(res.status).toBe(400);
      expect(mocks.savePersonAudioFile).not.toHaveBeenCalled();
    });

    it('removes the written file when the database insert fails', async () => {
      mocks.audioCreate.mockRejectedValue(new Error('db down'));
      const res = await POST(uploadRequest('p1', new Blob([MP3_BYTES])), ctx({ id: 'p1' }));
      expect(res.status).toBe(500);
      expect(mocks.deletePersonAudioFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/people/[id]/audio/[audioId]', () => {
    beforeEach(() => {
      mocks.audioFindFirst.mockResolvedValue({ id: 'a1', filename: 'a1.mp3', originalName: '241005_1430 café.mp3' });
    });

    it('streams the whole file', async () => {
      mocks.openPersonAudioFile.mockResolvedValue({ stream: streamOf(MP3_BYTES), start: 0, end: 7, totalSize: 8 });

      const res = await SERVE(new Request('http://localhost/api/people/p1/audio/a1'), ctx({ id: 'p1', audioId: 'a1' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
      expect(res.headers.get('Accept-Ranges')).toBe('bytes');
      expect(res.headers.get('Content-Length')).toBe('8');
      expect(res.headers.get('Content-Disposition')).toMatch(/^inline; /);
      expect(Buffer.from(await res.arrayBuffer()).equals(MP3_BYTES)).toBe(true);
      expect(mocks.audioFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'a1', personId: 'p1', person: { userId: 'user-123', deletedAt: null } },
      }));
      expect(mocks.openPersonAudioFile).toHaveBeenCalledWith('user-123', 'p1', 'a1.mp3', undefined);
    });

    it('answers range requests with 206', async () => {
      mocks.openPersonAudioFile.mockResolvedValue({ stream: streamOf(MP3_BYTES.subarray(2, 4)), start: 2, end: 3, totalSize: 8 });

      const res = await SERVE(
        new Request('http://localhost/api/people/p1/audio/a1', { headers: { Range: 'bytes=2-3' } }),
        ctx({ id: 'p1', audioId: 'a1' })
      );
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Range')).toBe('bytes 2-3/8');
      expect(res.headers.get('Content-Length')).toBe('2');
      expect(mocks.openPersonAudioFile).toHaveBeenCalledWith('user-123', 'p1', 'a1.mp3', { start: 2, end: 3 });
    });

    it('returns 416 for a range outside the file', async () => {
      mocks.openPersonAudioFile.mockResolvedValue({ unsatisfiable: true, totalSize: 8 });
      const res = await SERVE(
        new Request('http://localhost/api/people/p1/audio/a1', { headers: { Range: 'bytes=100-' } }),
        ctx({ id: 'p1', audioId: 'a1' })
      );
      expect(res.status).toBe(416);
      expect(res.headers.get('Content-Range')).toBe('bytes */8');
    });

    it('sends a download with the original name', async () => {
      mocks.openPersonAudioFile.mockResolvedValue({ stream: streamOf(MP3_BYTES), start: 0, end: 7, totalSize: 8 });
      const res = await SERVE(new Request('http://localhost/api/people/p1/audio/a1?download=1'), ctx({ id: 'p1', audioId: 'a1' }));
      expect(res.headers.get('Content-Disposition')).toBe(
        `attachment; filename="241005_1430 caf_.mp3"; filename*=UTF-8''241005_1430%20caf%C3%A9.mp3`
      );
    });

    it('returns 404 for an unknown recording', async () => {
      mocks.audioFindFirst.mockResolvedValue(null);
      const res = await SERVE(new Request('http://localhost/api/people/p1/audio/x'), ctx({ id: 'p1', audioId: 'x' }));
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/people/[id]/audio/[audioId]', () => {
    it('deletes the record and its file', async () => {
      mocks.audioFindFirst.mockResolvedValue({ id: 'a1', filename: 'a1.mp3', originalName: 'x.mp3' });
      mocks.audioDelete.mockResolvedValue({});

      const res = await DELETE(
        new Request('http://localhost/api/people/p1/audio/a1', { method: 'DELETE' }),
        ctx({ id: 'p1', audioId: 'a1' })
      );

      expect(res.status).toBe(200);
      expect(mocks.audioDelete).toHaveBeenCalledWith({ where: { id: 'a1' } });
      expect(mocks.deletePersonAudioFiles).toHaveBeenCalledWith('user-123', 'p1', ['a1.mp3']);
    });

    it('returns 404 when the recording is not found', async () => {
      mocks.audioFindFirst.mockResolvedValue(null);
      const res = await DELETE(
        new Request('http://localhost/api/people/p1/audio/a1', { method: 'DELETE' }),
        ctx({ id: 'p1', audioId: 'a1' })
      );
      expect(res.status).toBe(404);
      expect(mocks.audioDelete).not.toHaveBeenCalled();
    });
  });
});
