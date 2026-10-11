import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { contentDisposition, parseRangeHeader } from '@/lib/file-range';
import { isInlineMimeType } from '@/lib/document-types';
import { openDocumentFile, readDocumentThumbnail, type DocumentLocation } from '@/lib/person-document-storage';
import { removePersonDocument } from '@/lib/person-documents';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('people-documents');

async function findDocument(userId: string, personId: string, documentId: string) {
  return prisma.personDocument.findFirst({
    where: {
      id: documentId,
      personId,
      person: { userId, deletedAt: null },
    },
    select: {
      id: true,
      personId: true,
      sha256: true,
      legacyFilename: true,
      originalName: true,
      mimeType: true,
      hasThumbnail: true,
    },
  });
}

function locationOf(doc: { personId: string; sha256: string | null; legacyFilename: string | null }): DocumentLocation | null {
  if (doc.sha256) return { kind: 'blob', sha256: doc.sha256 };
  if (doc.legacyFilename) return { kind: 'legacy', personId: doc.personId, legacyFilename: doc.legacyFilename };
  return null;
}

// GET /api/people/[id]/documents/[documentId] - Serve a file (supports Range;
// ?size=thumb for the thumbnail, ?download=1 to save it)
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id, documentId } = await context.params;

    const doc = await findDocument(session.user.id, id, documentId);
    const location = doc ? locationOf(doc) : null;
    if (!doc || !location) {
      return new Response(null, { status: 404 });
    }

    const params = new URL(request.url).searchParams;
    const cacheHeaders = {
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    };

    if (params.get('size') === 'thumb') {
      const thumb = doc.hasThumbnail ? await readDocumentThumbnail(session.user.id, location) : null;
      if (!thumb) {
        return new Response(null, { status: 404 });
      }
      return new Response(new Uint8Array(thumb.buffer), {
        status: 200,
        headers: {
          ...cacheHeaders,
          'Content-Type': thumb.mimeType,
          'Content-Length': String(thumb.buffer.length),
        },
      });
    }

    const range = parseRangeHeader(request.headers.get('range'));
    const result = await openDocumentFile(session.user.id, location, range);
    if (!result) {
      return new Response(null, { status: 404 });
    }
    if ('unsatisfiable' in result) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${result.totalSize}` } });
    }

    // Only types the browser can show safely are served inline. Everything
    // else is a download, and nothing is ever rendered as a web page. The
    // Content-Security-Policy for this path is set in next.config.ts.
    const inline = isInlineMimeType(doc.mimeType) && params.get('download') !== '1';
    const contentType = doc.mimeType === 'text/plain' ? 'text/plain; charset=utf-8' : doc.mimeType;
    const headers: Record<string, string> = {
      ...cacheHeaders,
      'Content-Type': contentType,
      'Content-Length': String(result.end - result.start + 1),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', doc.originalName),
    };
    if (range) {
      headers['Content-Range'] = `bytes ${result.start}-${result.end}/${result.totalSize}`;
    }

    return new Response(result.stream, { status: range ? 206 : 200, headers });
  } catch {
    return new Response(null, { status: 500 });
  }
});

// DELETE /api/people/[id]/documents/[documentId] - Remove a file from a person's document folder
export const DELETE = withAuth(async (_request, session, context) => {
  try {
    const { id, documentId } = await context.params;

    const doc = await findDocument(session.user.id, id, documentId);
    if (!doc) {
      return apiResponse.notFound('Document not found');
    }

    await removePersonDocument(session.user.id, doc);

    log.info({ personId: id, documentId }, 'Person document deleted');
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/people/[id]/documents/[documentId]');
  }
});
