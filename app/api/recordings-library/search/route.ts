import { apiResponse, handleApiError } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { getLibraryConfig, isLibraryAvailable, LibraryQueryError, searchLibrary } from '@/lib/recordings-library';

export const runtime = 'nodejs';

const MAX_QUERY_LENGTH = 500;

// GET /api/recordings-library/search?q=... - Full-text search over the transcripts
export const GET = withAdmin(async (request) => {
  try {
    const config = getLibraryConfig();
    if (!config || !(await isLibraryAvailable(config))) {
      return apiResponse.notFound('No recordings library is configured');
    }
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (!q) {
      return apiResponse.error('Missing query');
    }
    if (q.length > MAX_QUERY_LENGTH) {
      return apiResponse.error(`Query is longer than ${MAX_QUERY_LENGTH} characters`);
    }
    try {
      const hits = await searchLibrary(config, q);
      if (hits === null) {
        return apiResponse.notFound('The recordings library has no search index');
      }
      return apiResponse.ok({ hits });
    } catch (error) {
      if (error instanceof LibraryQueryError) {
        return apiResponse.error('The search could not be understood. Check quotes and operators (AND, OR, NOT).');
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/recordings-library/search');
  }
});
