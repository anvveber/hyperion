import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import {
  deletePersonAudioFiles,
  openPersonAudioFile,
  parseRangeHeader,
} from '@/lib/person-audio-storage';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('people-audio');

async function findAudio(userId: string, personId: string, audioId: string) {
  return prisma.personAudio.findFirst({
    where: {
      id: audioId,
      personId,
      person: { userId, deletedAt: null },
    },
    select: { id: true, filename: true, originalName: true },
  });
}

// Content-Disposition value that keeps non-ASCII filenames intact (RFC 6266)
function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// GET /api/people/[id]/audio/[audioId] - Stream a recording (supports Range; ?download=1 to save it)
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id, audioId } = await context.params;

    const audio = await findAudio(session.user.id, id, audioId);
    if (!audio) {
      return new Response(null, { status: 404 });
    }

    const range = parseRangeHeader(request.headers.get('range'));
    const result = await openPersonAudioFile(session.user.id, id, audio.filename, range);
    if (!result) {
      return new Response(null, { status: 404 });
    }
    if ('unsatisfiable' in result) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${result.totalSize}` } });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';
    const headers: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(result.end - result.start + 1),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', audio.originalName),
      'Cache-Control': 'private, max-age=31536000, immutable',
    };
    if (range) {
      headers['Content-Range'] = `bytes ${result.start}-${result.end}/${result.totalSize}`;
    }

    return new Response(result.stream, { status: range ? 206 : 200, headers });
  } catch {
    return new Response(null, { status: 500 });
  }
});

// DELETE /api/people/[id]/audio/[audioId] - Remove a recording from a person's audio folder
export const DELETE = withAuth(async (_request, session, context) => {
  try {
    const { id, audioId } = await context.params;

    const audio = await findAudio(session.user.id, id, audioId);
    if (!audio) {
      return apiResponse.notFound('Recording not found');
    }

    await prisma.personAudio.delete({ where: { id: audio.id } });
    await deletePersonAudioFiles(session.user.id, id, [audio.filename]);

    log.info({ personId: id, audioId }, 'Person audio deleted');
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/people/[id]/audio/[audioId]');
  }
});
