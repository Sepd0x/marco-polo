import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapView } from './map/MapView.js';
import { TopBar } from './ui/TopBar.js';
import { ControlDock } from './ui/ControlDock.js';
import { CursorReadout, TelemetryBar } from './ui/TelemetryBar.js';
import { ResultsPanel } from './ui/ResultsPanel.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { IntroOverlay } from './ui/IntroOverlay.js';
import { IconRefresh } from './ui/icons.js';
import { estimateTileCount, ringBBox } from '@marco-polo/core';
import { useStore } from './state/store.js';
import { listScans } from './scan/persist.js';
import { formatCount } from './lib/format.js';
import { emit } from './lib/bus.js';
import { decodeAoi, writeAoiToUrl } from './lib/permalink.js';
import { applyAccent } from './lib/theme.js';
import { startUpdateChecker } from './lib/updates.js';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Restore the archive index on boot.
  useEffect(() => {
    void listScans().then((list) => useStore.getState().setArchive(list));
  }, []);

  // Accent theming: apply on boot and on change.
  useEffect(() => {
    applyAccent(useStore.getState().settings.accent);
    return useStore.subscribe((s) => s.settings.accent, applyAccent);
  }, []);

  // AOI permalinks: restore a shared area from the URL, keep the URL current.
  useEffect(() => {
    const shared = decodeAoi(window.location.hash);
    if (shared) {
      const s = useStore.getState();
      s.updateSettings({ zoom: shared.zoom });
      s.setArea(shared.ring, estimateTileCount(shared.ring, shared.zoom));
      const b = ringBBox(shared.ring);
      setTimeout(() => emit('flyto', { bbox: [b.west, b.south, b.east, b.north] }), 600);
    }
    return useStore.subscribe(
      (s) => s.area,
      (area) => writeAoiToUrl(area, useStore.getState().settings.zoom),
    );
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const s = useStore.getState();
      if (e.key === 'r' && s.phase === 'idle') s.setDrawMode(s.drawMode === 'rect' ? null : 'rect');
      if (e.key === 'p' && s.phase === 'idle') {
        s.setDrawMode(s.drawMode === 'polygon' ? null : 'polygon');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <MapView />
      <TopBar settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((v) => !v)} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      <ResultsPanel />
      <TelemetryBar />
      <CursorReadout />
      <ControlDock />
      <CompleteFlash />
      <UpdateToast />
      <IntroOverlay />
    </>
  );
}

/** Shown when a newer build is deployed on GitHub Pages. */
function UpdateToast() {
  const [available, setAvailable] = useState(false);
  useEffect(() => startUpdateChecker(() => setAvailable(true)), []);
  if (!available) return null;
  return (
    <div className="update-toast panel fade-up">
      <span className="label">new build deployed</span>
      <button className="btn primary" onClick={() => location.reload()}>
        <IconRefresh /> reload
      </button>
    </div>
  );
}

/** Brief banner when a scan finishes. */
function CompleteFlash() {
  const phase = useStore((s) => s.phase);
  const pools = useStore((s) => s.ranked.length);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (phase === 'complete') {
      setShow(true);
      const t = setTimeout(() => setShow(false), 5200);
      return () => clearTimeout(t);
    }
    setShow(false);
  }, [phase]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="complete-flash panel"
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
        >
          <span className="status-dot complete" />
          scan complete — {formatCount(pools)} pool{pools === 1 ? '' : 's'} answered polo
        </motion.div>
      )}
    </AnimatePresence>
  );
}
