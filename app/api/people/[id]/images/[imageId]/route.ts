import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { deletePersonImageFiles, readPersonImageFile } from '@/lib/person-image-storage';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('people-images');

async function findImage(userId: string, personId: string, imageId: string) {
  return prisma.personImage.findFirst({
    where: {
      id: imageId,
      personId,
      person: { userId, deletedAt: null },
    },
    select: { id: true, filename: true, thumbnail: true },
  });
}

// GET /api/people/[id]/images/[imageId] - Serve an image file (?size=thumb for the thumbnail)
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id, imageId } = await context.params;

    const image = await findImage(session.user.id, id, imageId);
    if (!image) {
      return new Response(null, { status: 404 });
    }

    const wantsThumb = new URL(request.url).searchParams.get('size') === 'thumb';
    const result = await readPersonImageFile(
      session.user.id,
      id,
      wantsThumb ? image.thumbnail : image.filename
    );
    if (!result) {
      return new Response(null, { status: 404 });
    }

    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(result.buffer.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
});

// DELETE /api/people/[id]/images/[imageId] - Remove an image from a person's folder
export const DELETE = withAuth(async (_request, session, context) => {
  try {
    const { id, imageId } = await context.params;

    const image = await findImage(session.user.id, id, imageId);
    if (!image) {
      return apiResponse.notFound('Image not found');
    }

    await prisma.personImage.delete({ where: { id: image.id } });
    await deletePersonImageFiles(session.user.id, id, [image.filename, image.thumbnail]);

    log.info({ personId: id, imageId }, 'Person image deleted');
    return apiResponse.success();
  } catch (error) {
    return handleApiError(error, 'DELETE /api/people/[id]/images/[imageId]');
  }
});
