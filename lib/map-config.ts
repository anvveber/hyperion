import type { SatelliteConfig } from '@/lib/map-styles';

/*
 * Satellite imagery comes from a tile provider set by whoever runs the
 * instance (MAP_SATELLITE_URL, usually with an API key in it), because the
 * free imagery services each want their own account and terms accepted.
 *
 * Browsers never see that URL: they load tiles from /api/map/satellite, which
 * fetches them from the provider. That keeps the key on the server and keeps
 * the Content Security Policy limited to our own origin. Nothing is stored.
 */

const DEFAULT_ATTRIBUTION = 'Satellite imagery';
const DEFAULT_MAXZOOM = 19;

export interface SatelliteSource extends SatelliteConfig {
  /** Provider URL template with {z}, {x} and {y} (server side only) */
  tiles: string;
}

type Env = Record<string, string | undefined>;

export function getSatelliteSource(env: Env = process.env): SatelliteSource | null {
  const tiles = env.MAP_SATELLITE_URL?.trim();
  if (!tiles) return null;
  if (!/^https:\/\//i.test(tiles) || !['{z}', '{x}', '{y}'].every((p) => tiles.includes(p))) return null;
  const maxzoom = Number(env.MAP_SATELLITE_MAXZOOM);
  return {
    tiles,
    attribution: env.MAP_SATELLITE_ATTRIBUTION?.trim() || DEFAULT_ATTRIBUTION,
    maxzoom: Number.isInteger(maxzoom) && maxzoom >= 1 && maxzoom <= 22 ? maxzoom : DEFAULT_MAXZOOM,
  };
}

/** What the browser needs to know: no URL, no key. */
export function getSatelliteConfig(env: Env = process.env): SatelliteConfig | null {
  const source = getSatelliteSource(env);
  return source ? { attribution: source.attribution, maxzoom: source.maxzoom } : null;
}

/** The provider URL for one tile, or null when the address is out of range. */
export function satelliteTileUrl(source: SatelliteSource, z: number, x: number, y: number): string | null {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > source.maxzoom) return null;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  return source.tiles.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
