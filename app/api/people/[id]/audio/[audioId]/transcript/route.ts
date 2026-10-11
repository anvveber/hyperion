import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError, withAuth } from '@/lib/api-utils';
import { parseStoredTranscript } from '@/lib/person-audio';

// GET /api/people/[id]/audio/[audioId]/transcript - The transcript copied with a recording
export const GET = withAuth(async (_request, session, context) => {
  try {
    const { id, audioId } = await context.params;
    const audio = await prisma.personAudio.findFirst({
      where: { id: audioId, personId: id, person: { userId: session.user.id, deletedAt: null } },
      select: { transcript: true, transcriptLanguage: true },
    });
    if (!audio) {
      return apiResponse.notFound('Recording not found');
    }
    const segments = parseStoredTranscript(audio.transcript);
    if (!segments) {
      return apiResponse.notFound('This recording has no transcript');
    }
    return apiResponse.ok({ language: audio.transcriptLanguage, segments });
  } catch (error) {
    return handleApiError(error, 'GET /api/people/[id]/audio/[audioId]/transcript');
  }
});
