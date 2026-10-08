import { useEffect } from 'react';
import { estimateTileCount, ringBBox } from '@marco-polo/core';
import { MapView } from './map/MapView.js';
import { Shell } from './ui/Shell.js';
import { useStore } from './state/store.js';
import { listScans } from './scan/persist.js';
import { emit } from './lib/bus.js';
import { decodeAoi, writeAoiToUrl } from './lib/permalink.js';
import { applyTheme, savedTheme } from './lib/theme.js';

export function App() {
  useEffect(() => {
    applyTheme(savedTheme());
    void listScans().then((list) => useStore.getState().setArchive(list));
  }, []);

  // A shared link opens its area. The zoom some old links carry is ignored and
  // never written into the settings of the person who opens the link.
  useEffect(() => {
    const shared = decodeAoi(window.location.hash);
    if (shared) {
      const s = useStore.getState();
      s.setArea(shared.ring, estimateTileCount(shared.ring, s.settings.zoom));
      const b = ringBBox(shared.ring);
      setTimeout(() => emit('flyto', { bbox: [b.west, b.south, b.east, b.north] }), 600);
    }
    return useStore.subscribe(
      (s) => s.area,
      (area) => writeAoiToUrl(area, useStore.getState().settings.zoom),
    );
  }, []);

  return <Shell map={<MapView />} />;
}
