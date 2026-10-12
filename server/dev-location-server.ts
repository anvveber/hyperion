/* Development: `npm run dev:location` runs the location server next to `npm run dev`. */
import { startLocationServer } from './location-server';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the environment.
}
if (!startLocationServer()) {
  console.error('Set LOCATION_PORT (for example 3001) to run the location server.');
  process.exit(1);
}
