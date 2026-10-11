import { apiResponse, handleApiError } from '@/lib/api-utils';
import { withAdmin } from '@/lib/admin';
import { getLibraryConfig, isLibraryAvailable, listMonth } from '@/lib/recordings-library';

export const runtime = 'nodejs';

// GET /api/recordings-library/month?year=2026&month=09 - Recordings of one month
export const GET = withAdmin(async (request) => {
  try {
    const config = getLibraryConfig();
    if (!config || !(await isLibraryAvailable(config))) {
      return apiResponse.notFound('No recordings library is configured');
    }
    const params = new URL(request.url).searchParams;
    const year = params.get('year') ?? '';
    const month = params.get('month') ?? '';
    if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
      return apiResponse.error('year must be YYYY and month MM');
    }
    return apiResponse.ok({ recordings: await listMonth(config, year, month) });
  } catch (error) {
    return handleApiError(error, 'GET /api/recordings-library/month');
  }
});
