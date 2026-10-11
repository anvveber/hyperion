import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { MAX_PERSON_DOCUMENTS, MAX_PERSON_DOCUMENT_UPLOAD_SIZE } from '@/lib/person-document-storage';
import { addPersonDocument, documentSelect } from '@/lib/person-documents';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('people-documents');

// GET /api/people/[id]/documents - List the files in a person's document folder
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

    const documents = await prisma.personDocument.findMany({
      where: { personId: id },
      orderBy: { createdAt: 'desc' },
      select: documentSelect,
    });

    return apiResponse.ok({ documents });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/documents');
  }
});

// POST /api/people/[id]/documents - Add a file to a person's document folder
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiResponse.error('Invalid form data');
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return apiResponse.error('No file provided');
    }
    if (file.size === 0) {
      return apiResponse.error('The file is empty');
    }
    if (file.size > MAX_PERSON_DOCUMENT_UPLOAD_SIZE) {
      return apiResponse.error(`File exceeds maximum size of ${MAX_PERSON_DOCUMENT_UPLOAD_SIZE / (1024 * 1024)}MB`);
    }

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const count = await prisma.personDocument.count({ where: { personId: id } });
    if (count >= MAX_PERSON_DOCUMENTS) {
      return apiResponse.error(`A person can have at most ${MAX_PERSON_DOCUMENTS} documents`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { document, duplicate } = await addPersonDocument(session.user.id, id, buffer, file.name, file.type);

    if (duplicate) {
      return apiResponse.ok({ document, duplicate: true });
    }
    log.info({ personId: id, documentId: document.id }, 'Person document uploaded');
    return apiResponse.created({ document, duplicate: false });
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/documents');
  }
});
