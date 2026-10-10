import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import {
  MAX_PERSON_IMAGES,
  MAX_PERSON_IMAGE_UPLOAD_SIZE,
  deletePersonImageFiles,
  processPersonImage,
  savePersonImageFiles,
} from '@/lib/person-image-storage';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('people-images');

const imageSelect = {
  id: true,
  width: true,
  height: true,
  size: true,
  createdAt: true,
} as const;

// GET /api/people/[id]/images - List the images in a person's folder
export const GET = withAuth(async (_request, session, context) => {
  try {
    const { id } = await context.params;

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const images = await prisma.personImage.findMany({
      where: { personId: id },
      orderBy: { createdAt: 'desc' },
      select: imageSelect,
    });

    return apiResponse.ok({ images });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/images');
  }
});

// POST /api/people/[id]/images - Add an image to a person's folder
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiResponse.error('Invalid form data');
    }

    const file = formData.get('image');
    if (!file || typeof file === 'string') {
      return apiResponse.error('No image file provided');
    }
    if (file.size > MAX_PERSON_IMAGE_UPLOAD_SIZE) {
      return apiResponse.error(`Image exceeds maximum size of ${MAX_PERSON_IMAGE_UPLOAD_SIZE / (1024 * 1024)}MB`);
    }

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const count = await prisma.personImage.count({ where: { personId: id } });
    if (count >= MAX_PERSON_IMAGES) {
      return apiResponse.error(`A person can have at most ${MAX_PERSON_IMAGES} images`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let processed;
    try {
      processed = await processPersonImage(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process image';
      return apiResponse.error(message);
    }

    const imageId = crypto.randomBytes(12).toString('hex');
    const files = await savePersonImageFiles(session.user.id, id, imageId, processed);

    try {
      const image = await prisma.personImage.create({
        data: {
          id: imageId,
          personId: id,
          filename: files.filename,
          thumbnail: files.thumbnail,
          width: processed.width,
          height: processed.height,
          size: processed.full.length,
        },
        select: imageSelect,
      });

      log.info({ personId: id, imageId }, 'Person image uploaded');
      return apiResponse.created({ image });
    } catch (error) {
      await deletePersonImageFiles(session.user.id, id, [files.filename, files.thumbnail]);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/images');
  }
});
