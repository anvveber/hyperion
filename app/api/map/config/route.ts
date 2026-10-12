import { apiResponse, withAuth } from '@/lib/api-utils';
import { getSatelliteConfig } from '@/lib/map-config';

// GET /api/map/config - Base maps the instance offers (satellite when MAP_SATELLITE_URL is set)
export const GET = withAuth(async () => {
  return apiResponse.ok({ satellite: getSatelliteConfig() });
});
