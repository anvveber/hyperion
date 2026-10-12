import type maplibregl from 'maplibre-gl';

/*
 * Base maps shared by the main map and the family maps.
 *
 * The OpenFreeMap dark style is near black throughout (buildings rgb(10) on
 * rgb(12), roads #181818), which makes streets hard to read on our graphite
 * UI. After each style load we repaint its layers on the app's grey scale:
 * land a step above the page background, water a step below, roads and
 * labels light enough to read, gold left to the markers. Layers are found by
 * id, so an id OpenFreeMap renames is simply left as it was.
 */

export const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export type BaseMap = 'map' | 'satellite';

/** The satellite base map as the browser sees it; tiles come from /api/map/satellite. */
export interface SatelliteConfig {
  attribution: string;
  maxzoom: number;
}

/** Absolute, because MapLibre loads tiles from a web worker. */
function satelliteTilesUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/api/map/satellite/{z}/{x}/{y}`;
}

type PaintValue = string | number | maplibregl.ExpressionSpecification;

/** layer id -> paint property -> value, for the dark style */
const DARK_PAINT: Record<string, Record<string, PaintValue>> = {
  background: { 'background-color': '#1b1c1e' },
  water: { 'fill-color': '#0d1114' },
  waterway: { 'line-color': '#0d1114' },
  landcover_ice_shelf: { 'fill-color': '#1b1c1e' },
  landcover_glacier: { 'fill-color': '#202124' },
  landuse_residential: { 'fill-color': '#1f2022', 'fill-opacity': 0.6 },
  landcover_wood: { 'fill-color': '#1c231d' },
  landuse_park: { 'fill-color': '#1d241e' },
  building: { 'fill-color': '#27282b', 'fill-outline-color': '#35363a' },
  'aeroway-area': { 'fill-color': '#232427' },
  'aeroway-taxiway': { 'line-color': '#3a3b3f' },
  'aeroway-runway-casing': { 'line-color': '#4a4b50' },
  'aeroway-runway': { 'line-color': '#303135' },
  road_area_pier: { 'fill-color': '#1b1c1e' },
  road_pier: { 'line-color': '#1b1c1e' },
  highway_path: { 'line-color': '#4a4b4f' },
  highway_minor: { 'line-color': '#45464b' },
  highway_major_casing: { 'line-color': '#26272a' },
  highway_major_inner: { 'line-color': '#55565b' },
  highway_major_subtle: { 'line-color': '#4a4b50' },
  highway_motorway_casing: { 'line-color': '#26272a' },
  highway_motorway_inner: { 'line-color': '#6e6f75' },
  highway_motorway_subtle: { 'line-color': '#5a5b60' },
  railway_transit: { 'line-color': '#4d4e52' },
  railway_transit_dashline: { 'line-color': '#1b1c1e' },
  railway_minor: { 'line-color': '#4d4e52' },
  railway_minor_dashline: { 'line-color': '#1b1c1e' },
  railway: { 'line-color': '#5a5b5f' },
  railway_dashline: { 'line-color': '#1b1c1e' },
  boundary_state: { 'line-color': '#5c5d62' },
  'boundary_country_z0-4': { 'line-color': '#6a6b70' },
  'boundary_country_z5-': { 'line-color': '#6a6b70' },
  water_name: { 'text-color': '#7f909c', 'text-halo-color': '#0d1114' },
  highway_name_other: { 'text-color': '#b3b4b8', 'text-halo-color': '#1b1c1e' },
  highway_name_motorway: { 'text-color': '#c4c5c9', 'text-halo-color': '#1b1c1e' },
};

const DARK_PLACE_LABEL: Record<string, PaintValue> = {
  'text-color': '#d6d7da',
  'text-halo-color': 'rgba(16,16,16,0.85)',
  'text-halo-width': 1.4,
};

/** Repaint the dark style for contrast. Call after every style load. */
export function tuneDarkStyle(map: maplibregl.Map): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const paint = DARK_PAINT[layer.id] ?? (layer.id.startsWith('place_') ? DARK_PLACE_LABEL : null);
    if (!paint) continue;
    for (const [prop, value] of Object.entries(paint)) {
      try {
        map.setPaintProperty(layer.id, prop, value);
      } catch {
        // A property this layer type doesn't have: leave it.
      }
    }
  }
}

/** A raster style with satellite imagery, for the given tile source. */
export function satelliteStyle(config: SatelliteConfig): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [satelliteTilesUrl()],
        tileSize: 256,
        maxzoom: config.maxzoom,
        attribution: config.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#101010' } },
      { id: 'satellite', type: 'raster', source: 'satellite' },
    ],
  };
}

/** The style to load for a theme and base map. Satellite falls back to the map when not configured. */
export function styleFor(isDark: boolean, base: BaseMap, satellite: SatelliteConfig | null): string | maplibregl.StyleSpecification {
  if (base === 'satellite' && satellite) return satelliteStyle(satellite);
  return isDark ? DARK_STYLE : LIGHT_STYLE;
}

/** A key that changes whenever styleFor would return a different style. */
export function styleKey(isDark: boolean, base: BaseMap, satellite: SatelliteConfig | null): string {
  return base === 'satellite' && satellite ? 'satellite' : isDark ? 'dark' : 'light';
}

/** Apply the theme tuning that belongs to the current style. */
export function tuneStyle(map: maplibregl.Map, key: string): void {
  if (key === 'dark') tuneDarkStyle(map);
}
