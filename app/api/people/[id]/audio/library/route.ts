import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiResponse, handleApiError } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import {
  MAX_PERSON_AUDIO,
  copyFileIntoPersonAudio,
  deletePersonAudioFiles,
  parseRecordingTimestamp,
} from '@/lib/person-audio-storage';
import { getLibraryConfig, isLibraryAvailable, readTranscript, resolveRecording } from '@/lib/recordings-library';
import { MAX_LIBRARY_IMPORT, personAudioSelect, withTranscriptFlags } from '@/lib/person-audio';
import { createModuleLogger } from '@/lib/logger';

export const runtime = 'nodejs';

const log = createModuleLogger('people-audio-library');

const bodySchema = z.object({
  paths: z.array(z.string().min(1).max(200)).min(1).max(MAX_LIBRARY_IMPORT),
});

type Outcome = 'added' | 'alreadyAdded' | 'notFound' | 'failed';

// POST /api/people/[id]/audio/library - Copy recordings from the recordings library, with their transcripts
export const POST = withAdmin(async (request, session, context) => {
  try {
    const { id } = await context.params;

    const config = getLibraryConfig();
    if (!config || !(await isLibraryAvailable(config))) {
      return apiResponse.notFound('No recordings library is configured');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiResponse.error('Invalid JSON body');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return apiResponse.error(`Send between 1 and ${MAX_LIBRARY_IMPORT} recording paths`);
    }
    const paths = [...new Set(parsed.data.paths)];

    const person = await prisma.person.findUnique({
      where: { id, userId: session.user.id, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      return apiResponse.notFound('Person not found');
    }

    const existing = await prisma.personAudio.findMany({
      where: { personId: id, sourcePath: { in: paths } },
      select: { sourcePath: true },
    });
    const alreadyAdded = new Set(existing.map((a) => a.sourcePath));
    let count = await prisma.personAudio.count({ where: { personId: id } });

    const results: { path: string; outcome: Outcome }[] = [];
    const createdIds: string[] = [];

    for (const rel of paths) {
      if (alreadyAdded.has(rel)) {
        results.push({ path: rel, outcome: 'alreadyAdded' });
        continue;
      }
      if (count >= MAX_PERSON_AUDIO) {
        results.push({ path: rel, outcome: 'failed' });
        continue;
      }
      const source = await resolveRecording(config, rel);
      if (!source) {
        results.push({ path: rel, outcome: 'notFound' });
        continue;
      }

      const audioId = crypto.randomBytes(12).toString('hex');
      let stored: { filename: string; size: number } | null = null;
      try {
        stored = await copyFileIntoPersonAudio(session.user.id, id, audioId, source);
        const transcript = await readTranscript(config, rel);
        const originalName = path.basename(rel);
        await prisma.personAudio.create({
          data: {
            id: audioId,
            personId: id,
            filename: stored.filename,
            originalName,
            recordedAt: parseRecordingTimestamp(originalName),
            size: stored.size,
            sourcePath: rel,
            transcript: transcript ? (transcript.segments as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            transcriptLanguage: transcript?.language ?? null,
            durationMs: transcript?.durationMs ?? null,
          },
        });
        createdIds.push(audioId);
        count += 1;
        results.push({ path: rel, outcome: 'added' });
      } catch (error) {
        if (stored) await deletePersonAudioFiles(session.user.id, id, [stored.filename]);
        log.error({ err: error instanceof Error ? error : new Error(String(error)), personId: id, rel }, 'Library import failed');
        results.push({ path: rel, outcome: 'failed' });
      }
    }

    const audio = createdIds.length > 0
      ? await withTranscriptFlags(
          await prisma.personAudio.findMany({ where: { id: { in: createdIds } }, select: personAudioSelect })
        )
      : [];

    log.info({ personId: id, added: createdIds.length, requested: paths.length }, 'Recordings added from library');
    return apiResponse.ok({ audio, results });
  } catch (error) {
    return handleApiError(error, 'POST /api/people/[id]/audio/library');
  }
});
