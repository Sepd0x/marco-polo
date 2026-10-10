import { useEffect, type ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { useIsPhone, useMapView } from './hooks.js';
import { useUi } from './uiState.js';
import { viewRing } from './model.js';
import { useSetArea } from './Sections.js';
import { SidePanel } from './SidePanel.js';
import { PhoneSheet, PhoneTop } from './PhoneChrome.js';
import { DataStrip, Legend, MapScale, MapTools } from './MapChrome.js';
import { SettingsDialog } from './Settings.js';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Keys: R rectangle, P shape, V scan this view, / search, Esc closes the innermost thing open. */
function useKeys() {
  const view = useMapView();
  const setArea = useSetArea();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.key === 'Escape') {
        if (useUi.getState().settingsOpen) return;
        if (useUi.getState().sourcePickerOpen) return useUi.getState().setSourcePickerOpen(false);
        if (s.drawMode) return s.setDrawMode(null);
        if (s.selectedId) return s.select(null);
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        const input = document.querySelector<HTMLInputElement>('.search input');
        if (input) {
          e.preventDefault();
          input.focus();
        }
        return;
      }
      if (s.phase !== 'idle' && s.phase !== 'ready') return;
      const k = e.key.toLowerCase();
      if (k === 'r') s.setDrawMode(s.drawMode === 'rect' ? null : 'rect');
      else if (k === 'p') s.setDrawMode(s.drawMode === 'polygon' ? null : 'polygon');
      else if (k === 'v' && view) setArea(viewRing(view.bbox));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, setArea]);
}

/**
 * Page layout. The map sits in a frame like a survey photograph: margins for
 * the graduation, the data strip underneath. The map is passed in so tests
 * can render the rest without WebGL.
 */
export function Shell({ map }: { map: ReactNode }) {
  const phone = useIsPhone();
  const phase = useStore((s) => s.phase);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const live = phase === 'scanning' || phase === 'paused';
  useKeys();

  return (
    <div className={`app${phone ? ' phone' : ''}`}>
      {phone ? <PhoneTop /> : <SidePanel />}
      <main className="frame" aria-label="Map">
        <div className="viewport">
          {map}
          {!phone && <MapTools />}
          {!phone && live && <Legend />}
          <MapScale />
        </div>
        <DataStrip phone={phone} />
      </main>
      {phone && <PhoneSheet />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
