import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import {
  MAX_PERSON_AUDIO,
  MAX_PERSON_AUDIO_UPLOAD_SIZE,
  deletePersonAudioFiles,
  isMp3Buffer,
  parseRecordingTimestamp,
  sanitizeOriginalName,
  savePersonAudioFile,
} from '@/lib/person-audio-storage';
import { createModuleLogger } from '@/lib/logger';
import { personAudioSelect, withTranscriptFlags } from '@/lib/person-audio';

const log = createModuleLogger('people-audio');

const audioSelect = personAudioSelect;

// GET /api/people/[id]/audio - List the recordings in a person's audio folder
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

    // Newest recording first; files without a date in their name go last
    const audio = await prisma.personAudio.findMany({
      where: { personId: id },
      orderBy: [{ recordedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: audioSelect,
    });

    return apiResponse.ok({ audio: await withTranscriptFlags(audio) });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/audio');
  }
});

// POST /api/people/[id]/audio - Add an MP3 recording to a person's audio folder
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiResponse.error('Invalid form data');
    }

    const file = formData.get('audio');
    if (!file || typeof file === 'string') {
      return apiResponse.error('No audio file provided');
    }
    if (file.size > MAX_PERSON_AUDIO_UPLOAD_SIZE) {
      return apiResponse.error(`Audio file exceeds maximum size of ${MAX_PERSON_AUDIO_UPLOAD_SIZE / (1024 * 1024)}MB`);
    }

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const count = await prisma.personAudio.count({ where: { personId: id } });
    if (count >= MAX_PERSON_AUDIO) {
      return apiResponse.error(`A person can have at most ${MAX_PERSON_AUDIO} recordings`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isMp3Buffer(buffer)) {
      return apiResponse.error('Unsupported audio format. Only MP3 files are accepted');
    }

    const originalName = sanitizeOriginalName(file.name);
    const audioId = crypto.randomBytes(12).toString('hex');
    const filename = await savePersonAudioFile(session.user.id, id, audioId, buffer);

    try {
      const audio = await prisma.personAudio.create({
        data: {
          id: audioId,
          personId: id,
          filename,
          originalName,
          recordedAt: parseRecordingTimestamp(originalName),
          size: buffer.length,
        },
        select: audioSelect,
      });

      log.info({ personId: id, audioId }, 'Person audio uploaded');
      return apiResponse.created({ audio: { ...audio, hasTranscript: false } });
    } catch (error) {
      await deletePersonAudioFiles(session.user.id, id, [filename]);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/audio');
  }
});
