import { withAdmin } from '@/lib/admin';
import { contentDisposition, parseRangeHeader } from '@/lib/file-range';
import { getLibraryConfig, openLibraryRecording } from '@/lib/recordings-library';

export const runtime = 'nodejs';

// GET /api/recordings-library/audio?path=YYYY/MM/name.mp3 - Stream a library recording for preview (supports Range)
export const GET = withAdmin(async (request) => {
  try {
    const config = getLibraryConfig();
    if (!config) {
      return new Response(null, { status: 404 });
    }
    const rel = new URL(request.url).searchParams.get('path') ?? '';
    const range = parseRangeHeader(request.headers.get('range'));
    const result = await openLibraryRecording(config, rel, range);
    if (!result) {
      return new Response(null, { status: 404 });
    }
    if ('unsatisfiable' in result) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${result.totalSize}` } });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(result.end - result.start + 1),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': contentDisposition('inline', rel.split('/').pop() ?? 'recording.mp3'),
      'Cache-Control': 'private, max-age=3600',
    };
    if (range) {
      headers['Content-Range'] = `bytes ${result.start}-${result.end}/${result.totalSize}`;
    }
    return new Response(result.stream, { status: range ? 206 : 200, headers });
  } catch {
    return new Response(null, { status: 500 });
  }
});
