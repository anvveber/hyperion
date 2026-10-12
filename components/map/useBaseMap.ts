'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BaseMap, SatelliteConfig } from '@/lib/map-styles';

const STORAGE_KEY = 'hyperion.baseMap';
const CHANGE_EVENT = 'hyperion:basemap';

let configPromise: Promise<SatelliteConfig | null> | null = null;

/** The instance's satellite source, fetched once per page load. */
function loadSatelliteConfig(): Promise<SatelliteConfig | null> {
  configPromise ??= fetch('/api/map/config')
    .then((res) => (res.ok ? (res.json() as Promise<{ satellite: SatelliteConfig | null }>) : { satellite: null }))
    .then((data) => data.satellite)
    .catch(() => {
      configPromise = null;
      return null;
    });
  return configPromise;
}

function readStoredBase(): BaseMap {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'satellite' ? 'satellite' : 'map';
  } catch {
    return 'map';
  }
}

/**
 * Which base map to show (remembered per browser, shared by every map on the
 * page) and the satellite source, null when the instance has none.
 */
export function useBaseMap(): { base: BaseMap; setBase: (b: BaseMap) => void; satellite: SatelliteConfig | null } {
  const [base, setBaseState] = useState<BaseMap>(readStoredBase);
  const [satellite, setSatellite] = useState<SatelliteConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSatelliteConfig().then((config) => {
      if (!cancelled) setSatellite(config);
    });
    const sync = () => setBaseState(readStoredBase());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setBase = useCallback((b: BaseMap) => {
    try {
      localStorage.setItem(STORAGE_KEY, b);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setBaseState(b);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { base: satellite ? base : 'map', setBase, satellite };
}
