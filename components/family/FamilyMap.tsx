'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { styleFor, styleKey, tuneStyle } from '@/lib/map-styles';
import { useBaseMap } from '@/components/map/useBaseMap';
import BaseMapToggle from '@/components/map/BaseMapToggle';
const SINGLE_ZOOM = 15;
const MAX_FIT_ZOOM = 15;

export interface FamilyMapPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Accuracy in metres, drawn as a faint circle */
  acc: number | null;
  /** Older than the "recent" threshold: drawn muted */
  stale: boolean;
  isMe?: boolean;
}

interface FamilyMapProps {
  points: FamilyMapPoint[];
  /** Pixel height of the map */
  height: number;
  /** Hide zoom buttons (the profile minimap) */
  compact?: boolean;
  ariaLabel: string;
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')));
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** A marker element: initials in a gold disc, with the name under it. */
function markerElement(point: FamilyMapPoint): HTMLElement {
  const root = document.createElement('div');
  root.className = 'flex flex-col items-center pointer-events-none select-none';

  const disc = document.createElement('div');
  disc.className = [
    'w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs font-semibold border-2 shadow',
    point.stale ? 'bg-surface-elevated text-muted border-border' : 'bg-primary text-on-primary border-surface',
  ].join(' ');
  disc.textContent = initials(point.name);

  const label = document.createElement('div');
  label.className = 'mt-1 px-1.5 py-0.5 rounded bg-surface/90 border border-border font-mono text-[0.625rem] text-foreground whitespace-nowrap';
  label.textContent = point.name;

  root.append(disc, label);
  return root;
}

/** Circle polygon around a point, radius in metres, for the accuracy halo. */
function circle(lat: number, lon: number, radiusM: number, steps = 48): [number, number][] {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return coords;
}

/** Center on one point, or fit all of them, leaving room for the name labels. */
function frame(map: maplibregl.Map, points: FamilyMapPoint[], compact: boolean) {
  if (points.length === 1) {
    map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: SINGLE_ZOOM });
  } else if (points.length > 1) {
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend([p.lon, p.lat]));
    const side = compact ? 40 : 60;
    map.fitBounds(bounds, { padding: { top: side, bottom: side + 30, left: side, right: side }, maxZoom: MAX_FIT_ZOOM, duration: 0 });
  }
}

function halosFor(points: FamilyMapPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points
      .filter((p): p is FamilyMapPoint & { acc: number } => p.acc !== null && p.acc > 0 && p.acc < 5000)
      .map((p) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [circle(p.lat, p.lon, p.acc)] },
      })),
  };
}

/**
 * A small MapLibre map with one marker per family member. Used full size on
 * the Family page and as a minimap on a person's profile.
 *
 * Markers are DOM elements and do not depend on the map style, so they show
 * even when the tile server cannot be reached. The accuracy halos are style
 * layers and are added again after every style load (theme switch).
 */
export default function FamilyMap({ points, height, compact = false, ariaLabel }: FamilyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pointsRef = useRef(points);
  const currentStyleRef = useRef<string | null>(null);
  const isDark = useIsDark();
  const { base, setBase, satellite } = useBaseMap();

  // Create the map once. Effects run in order, so the map exists before the
  // theme and marker effects below run in the same commit.
  useEffect(() => {
    if (!containerRef.current) return;
    // The satellite source arrives later; start on the map and switch then.
    const dark = document.documentElement.classList.contains('dark');
    currentStyleRef.current = styleKey(dark, 'map', null);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(dark, 'map', null),
      center: [12.5, 41.9],
      zoom: 4,
      attributionControl: { compact: true },
      cooperativeGestures: compact,
    });
    if (!compact) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Runs after the first style load and after every setStyle.
    map.on('style.load', () => {
      tuneStyle(map, currentStyleRef.current ?? '');
      map.addSource('accuracy', { type: 'geojson', data: halosFor(pointsRef.current) });
      map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#D4A72C', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': '#D4A72C', 'line-opacity': 0.5, 'line-width': 1 } });
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [compact]);

  // Follow the theme and the Map / Satellite choice.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = styleKey(isDark, base, satellite);
    if (currentStyleRef.current === key) return;
    currentStyleRef.current = key;
    map.setStyle(styleFor(isDark, base, satellite));
  }, [isDark, base, satellite]);

  // Draw markers and halos, then frame them.
  useEffect(() => {
    pointsRef.current = points;
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = points.map((p) =>
      new maplibregl.Marker({ element: markerElement(p), anchor: 'top', offset: [0, -16] }).setLngLat([p.lon, p.lat]).addTo(map)
    );

    const source = map.getSource('accuracy') as maplibregl.GeoJSONSource | undefined;
    source?.setData(halosFor(points));

    frame(map, points, compact);
  }, [points, compact]);

  // Keep the map sized to its box and everyone in view when the layout settles
  // or changes (phones rotate, side panels wrap).
  useEffect(() => {
    const el = containerRef.current;
    const map = mapRef.current;
    if (!el || !map || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      map.resize();
      frame(map, pointsRef.current, compact);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [compact]);

  return (
    <div className="relative w-full border border-border rounded-lg overflow-hidden" style={{ height }}>
      <div ref={containerRef} role="region" aria-label={ariaLabel} className="h-full w-full" />
      {satellite && <BaseMapToggle base={base} onChange={setBase} />}
    </div>
  );
}
