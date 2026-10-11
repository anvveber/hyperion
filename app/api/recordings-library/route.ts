import { apiResponse, handleApiError } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { getLibraryConfig, hasSearchIndex, isLibraryAvailable, listMonths } from '@/lib/recordings-library';

export const runtime = 'nodejs';

// GET /api/recordings-library - Whether a recordings library is configured, and its months
export const GET = withAdmin(async () => {
  try {
    const config = getLibraryConfig();
    if (!config || !(await isLibraryAvailable(config))) {
      return apiResponse.ok({ available: false, searchable: false, months: [] });
    }
    const [months, searchable] = await Promise.all([listMonths(config), hasSearchIndex(config)]);
    return apiResponse.ok({ available: true, searchable, months });
  } catch (error) {
    return handleApiError(error, 'GET /api/recordings-library');
  }
});
