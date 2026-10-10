import { useState } from 'react';
import { useStore } from '../state/store.js';
import { currentTheme, setTheme, type Theme } from '../lib/theme.js';
import { SearchBox } from './SearchBox.js';
import { ImageryNotice } from './Notice.js';
import {
  AreaSection,
  DrawSection,
  ListSection,
  ProgressSection,
  SavedScans,
  SummarySection,
  ThresholdSection,
} from './Sections.js';
import { useUi } from './uiState.js';
import { useNothingScanned } from './hooks.js';
import { IconMoon, IconSliders, IconSun, Mark } from './icons.js';

function ThemeButton() {
  const [theme, set] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="icon-btn"
      aria-label={next === 'dark' ? 'Dark theme' : 'Light theme'}
      title={next === 'dark' ? 'Dark theme' : 'Light theme'}
      onClick={() => {
        setTheme(next);
        set(next);
      }}
    >
      {next === 'dark' ? <IconMoon /> : <IconSun />}
    </button>
  );
}

/** Desktop: everything about the scan in one column of rules, the framed map gets the rest. */
export function SidePanel() {
  const phase = useStore((s) => s.phase);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const live = phase === 'scanning' || phase === 'paused';
  const nothing = useNothingScanned();

  return (
    <aside className="side" aria-label="Scan">
      <div className="top">
        <div className="brand">
          <Mark />
          <h1>Marco Polo</h1>
        </div>
        <span className="grow" />
        <ThemeButton />
        <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
          <IconSliders />
        </button>
      </div>
      <SearchBox shortcut />
      <div className="scroll">
        <ImageryNotice />
        {phase === 'idle' && (
          <>
            <DrawSection />
            <SavedScans />
          </>
        )}
        {phase === 'ready' && (
          <>
            <AreaSection />
            <SavedScans />
          </>
        )}
        {live && (
          <>
            <AreaSection />
            <ProgressSection />
            <ListSection />
          </>
        )}
        {phase === 'complete' && (
          <>
            <SummarySection />
            {!nothing && (
              <>
                <ThresholdSection />
                <ListSection />
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
