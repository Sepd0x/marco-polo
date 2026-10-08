import { useEffect, type ReactNode } from 'react';
import { useStore } from '../state/store.js';
import { useIsPhone, useMapView } from './hooks.js';
import { useUi } from './uiState.js';
import { viewRing } from './model.js';
import { useSetArea } from './Sections.js';
import { SidePanel } from './SidePanel.js';
import { PhoneChrome } from './PhoneChrome.js';
import { ImageryChip, Legend, useChipSource } from './MapChrome.js';
import { Inspector } from './Inspector.js';
import { SettingsDialog } from './Settings.js';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Keys: R rectangle, P shape, V scan this view, Esc closes the innermost thing open. */
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

/** Page layout. The map is passed in so tests can render the rest without WebGL. */
export function Shell({ map }: { map: ReactNode }) {
  const phone = useIsPhone();
  const phase = useStore((s) => s.phase);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const source = useChipSource();
  const live = phase === 'scanning' || phase === 'paused';
  useKeys();

  return (
    <div className={`app${phone ? ' phone' : ''}`}>
      {!phone && <SidePanel />}
      <main className="map-wrap" aria-label="Map">
        {map}
        {!phone && (
          <>
            <ImageryChip />
            {live && <Legend />}
            <Inspector phone={false} sourceName={source?.name ?? null} />
          </>
        )}
        {phone && <PhoneChrome sourceName={source?.name ?? null} />}
      </main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
