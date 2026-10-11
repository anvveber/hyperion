import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { TranscriptSegment } from '@/lib/recordings-library';

/** Most recordings that can be added from the library in one request. */
export const MAX_LIBRARY_IMPORT = 20;

/**
 * Fields the audio folder lists. The transcript itself is left out (it can
 * be long); withTranscriptFlags adds whether one is there.
 */
export const personAudioSelect = {
  id: true,
  originalName: true,
  recordedAt: true,
  size: true,
  createdAt: true,
  sourcePath: true,
  transcriptLanguage: true,
  durationMs: true,
} as const;

type ListedAudio = Prisma.PersonAudioGetPayload<{ select: typeof personAudioSelect }>;

/** Add `hasTranscript` to listed recordings with one extra query. */
export async function withTranscriptFlags<T extends ListedAudio>(audio: T[]): Promise<(T & { hasTranscript: boolean })[]> {
  if (audio.length === 0) return [];
  const withTranscript = await prisma.personAudio.findMany({
    where: { id: { in: audio.map((a) => a.id) }, NOT: { transcript: { equals: Prisma.DbNull } } },
    select: { id: true },
  });
  const ids = new Set(withTranscript.map((a) => a.id));
  return audio.map((a) => ({ ...a, hasTranscript: ids.has(a.id) }));
}

/** Read a stored transcript back, dropping anything malformed. Null when there is none. */
export function parseStoredTranscript(value: Prisma.JsonValue | null): TranscriptSegment[] | null {
  if (!Array.isArray(value)) return null;
  const segments: TranscriptSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { s, e, t } = item as { s?: unknown; e?: unknown; t?: unknown };
    if (typeof s === 'number' && typeof e === 'number' && typeof t === 'string') segments.push({ s, e, t });
  }
  return segments.length > 0 ? segments : null;
}
