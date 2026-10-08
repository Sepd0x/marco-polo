import { useEffect } from 'react';
import { MapView } from './map/MapView.js';
import { Shell } from './ui/Shell.js';
import { useStore } from './state/store.js';
import { listScans } from './scan/persist.js';
import { bindPermalink } from './lib/permalink.js';
import { applyTheme, savedTheme } from './lib/theme.js';

export function App() {
  useEffect(() => {
    applyTheme(savedTheme());
    void listScans().then((list) => useStore.getState().setArchive(list));
  }, []);

  // A shared link opens its area once the map is ready. The zoom some old
  // links carry is ignored and never written into the settings of the person
  // who opens the link.
  useEffect(() => bindPermalink(), []);

  return <Shell map={<MapView />} />;
}
