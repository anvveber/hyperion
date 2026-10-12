// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { DARK_STYLE, LIGHT_STYLE, satelliteStyle, styleFor, styleKey, tuneDarkStyle, tuneStyle } from '@/lib/map-styles';
import { getSatelliteConfig, getSatelliteSource, satelliteTileUrl } from '@/lib/map-config';

const sat = { attribution: 'Example', maxzoom: 19 };

describe('satellite settings', () => {
  it('is off unless an https XYZ template is set', () => {
    expect(getSatelliteSource({})).toBeNull();
    expect(getSatelliteSource({ MAP_SATELLITE_URL: 'http://x/{z}/{x}/{y}' })).toBeNull();
    expect(getSatelliteSource({ MAP_SATELLITE_URL: 'https://x/{z}/{x}' })).toBeNull();
  });

  it('keeps the provider URL and key on the server', () => {
    const env = { MAP_SATELLITE_URL: 'https://x/{z}/{y}/{x}?token=k' };
    expect(getSatelliteSource(env)).toEqual({ tiles: 'https://x/{z}/{y}/{x}?token=k', attribution: 'Satellite imagery', maxzoom: 19 });
    expect(getSatelliteConfig(env)).toEqual({ attribution: 'Satellite imagery', maxzoom: 19 });
  });

  it('reads attribution and max zoom', () => {
    expect(getSatelliteConfig({ MAP_SATELLITE_URL: 'https://x/{z}/{x}/{y}', MAP_SATELLITE_ATTRIBUTION: '© P', MAP_SATELLITE_MAXZOOM: '17' })).toMatchObject({
      attribution: '© P', maxzoom: 17,
    });
    expect(getSatelliteConfig({ MAP_SATELLITE_URL: 'https://x/{z}/{x}/{y}', MAP_SATELLITE_MAXZOOM: '99' })?.maxzoom).toBe(19);
  });

  it('builds tile URLs only for tiles that exist', () => {
    const source = { tiles: 'https://x/{z}/{y}/{x}?k=1', attribution: 'a', maxzoom: 18 };
    expect(satelliteTileUrl(source, 3, 5, 2)).toBe('https://x/3/2/5?k=1');
    expect(satelliteTileUrl(source, 3, 8, 0)).toBeNull();
    expect(satelliteTileUrl(source, 19, 0, 0)).toBeNull();
    expect(satelliteTileUrl(source, 2, -1, 0)).toBeNull();
    expect(satelliteTileUrl(source, 1.5, 0, 0)).toBeNull();
  });
});

describe('styleFor and styleKey', () => {
  it('uses the themed vector style unless satellite is chosen and configured', () => {
    expect(styleFor(true, 'map', sat)).toBe(DARK_STYLE);
    expect(styleFor(false, 'map', sat)).toBe(LIGHT_STYLE);
    expect(styleFor(true, 'satellite', null)).toBe(DARK_STYLE);
    expect(styleFor(true, 'satellite', sat)).toEqual(satelliteStyle(sat));
    expect([styleKey(true, 'map', sat), styleKey(false, 'map', sat), styleKey(true, 'satellite', sat), styleKey(true, 'satellite', null)]).toEqual([
      'dark', 'light', 'satellite', 'dark',
    ]);
  });

  it('builds a raster style with the attribution and glyphs for cluster labels', () => {
    const style = satelliteStyle(sat);
    expect(style.sources.satellite).toMatchObject({ type: 'raster', tiles: ['/api/map/satellite/{z}/{x}/{y}'], maxzoom: 19, attribution: 'Example' });
    expect(style.glyphs).toContain('{fontstack}');
  });
});

describe('tuneDarkStyle', () => {
  function fakeMap(ids: string[]) {
    const setPaintProperty = vi.fn((id: string, prop: string) => {
      if (prop === 'text-halo-width' && id === 'broken') throw new Error('nope');
    });
    const map = { getStyle: () => ({ layers: ids.map((id) => ({ id })) }), setPaintProperty } as unknown as maplibregl.Map;
    return { map, setPaintProperty };
  }

  it('repaints known layers and place labels, and leaves unknown ones alone', () => {
    const { map, setPaintProperty } = fakeMap(['background', 'building', 'place_city', 'something_new']);
    tuneDarkStyle(map);
    const touched = new Set(setPaintProperty.mock.calls.map((c) => c[0]));
    expect([...touched].sort()).toEqual(['background', 'building', 'place_city']);
    expect(setPaintProperty).toHaveBeenCalledWith('place_city', 'text-color', expect.any(String));
  });

  it('only tunes the dark vector style', () => {
    const { map, setPaintProperty } = fakeMap(['background']);
    tuneStyle(map, 'light');
    tuneStyle(map, 'satellite');
    expect(setPaintProperty).not.toHaveBeenCalled();
    tuneStyle(map, 'dark');
    expect(setPaintProperty).toHaveBeenCalled();
  });
});
