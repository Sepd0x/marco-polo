import { useState } from 'react';
import { useStore } from '../state/store.js';
import { SearchBox } from './SearchBox.js';
import { ImageryNotice } from './Notice.js';
import { AreaSection, DrawSection, ListSection, ProgressSection, SavedScans, SummarySection, ThresholdSection } from './Sections.js';
import { useUi } from './uiState.js';
import { useNothingScanned } from './hooks.js';
import { IconSliders, Mark } from './icons.js';

/** Phone: the mark, the search and the settings above the framed map. */
export function PhoneTop() {
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  return (
    <header className="phone-top">
      <Mark />
      <h1 className="sr-only">Marco Polo</h1>
      <SearchBox placeholder="Search a place" />
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
        <IconSliders />
      </button>
    </header>
  );
}

/**
 * Phone: the sheet under the map. It never lies over the map, so the drawn
 * area and the open pool always stay in view above it; the map shrinks or
 * grows when the sheet is shown or hidden.
 */
export function PhoneSheet() {
  const phase = useStore((s) => s.phase);
  const [collapsed, setCollapsed] = useState(false);
  const live = phase === 'scanning' || phase === 'paused';
  const nothing = useNothingScanned();

  let body;
  if (phase === 'idle') {
    body = (
      <>
        <DrawSection compact />
        <SavedScans />
      </>
    );
  } else if (phase === 'ready') {
    body = <AreaSection />;
  } else if (live) {
    body = (
      <>
        <ProgressSection phone />
        <ListSection />
      </>
    );
  } else {
    body = (
      <>
        <SummarySection phone />
        {!nothing && (
          <>
            <ThresholdSection phone />
            <ListSection phone />
          </>
        )}
      </>
    );
  }

  return (
    <div className={`sheet${collapsed ? ' collapsed' : ''}`}>
      <button
        className="grab"
        aria-label={collapsed ? 'Show the panel' : 'Hide the panel'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <i />
      </button>
      <div className="sheet-body">
        <ImageryNotice />
        {body}
      </div>
    </div>
  );
}
