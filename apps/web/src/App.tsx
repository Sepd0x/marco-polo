import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MapView } from './map/MapView.js';
import { HUD } from './ui/HUD.js';
import { ControlDock } from './ui/ControlDock.js';
import { CursorReadout, TelemetryBar } from './ui/TelemetryBar.js';
import { ResultsPanel } from './ui/ResultsPanel.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { SearchBox } from './ui/SearchBox.js';
import { IntroOverlay } from './ui/IntroOverlay.js';
import { useStore } from './state/store.js';
import { listScans } from './scan/persist.js';
import { formatCount } from './lib/format.js';
import { applyAccent } from './lib/theme.js';
import { startUpdateChecker } from './lib/updates.js';

const REPO_URL = 'https://github.com/Sepd0x/marco-polo';

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
      <HUD />
      <div className="top-right">
        <SearchBox />
        <button
          className={`btn icon-btn panel ${settingsOpen ? 'active' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title="Scanner settings"
        >
          ⚙
        </button>
        <a
          className="btn icon-btn panel"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          title="Source on GitHub"
        >
          ⌥
        </a>
      </div>
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
      <span className="label">new version deployed</span>
      <button className="btn primary" onClick={() => location.reload()}>
        ↻ reload
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
