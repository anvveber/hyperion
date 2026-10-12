import { apiResponse, withAuth } from '@/lib/api-utils';
import { getSatelliteSource, satelliteTileUrl } from '@/lib/map-config';
import { createModuleLogger } from '@/lib/logger';

const log = createModuleLogger('map-satellite');
const TIMEOUT_MS = 10_000;

// GET /api/map/satellite/[z]/[x]/[y] - One satellite tile, fetched from the configured provider
export const GET = withAuth(async (_request, _session, context) => {
  const source = getSatelliteSource();
  if (!source) return apiResponse.notFound('Satellite imagery is not configured');

  const { z, x, y } = await context.params;
  const url = satelliteTileUrl(source, Number(z), Number(x), Number(y));
  if (!url) return apiResponse.notFound('No such tile');

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) {
      // Providers answer 404 or a blank tile where they have no imagery.
      if (upstream.status !== 404) log.warn({ status: upstream.status, type }, 'Satellite provider refused a tile');
      return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': type,
        // Imagery changes rarely; let the browser keep tiles for a day.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Satellite provider unreachable');
    return new Response(null, { status: 504 });
  }
});
