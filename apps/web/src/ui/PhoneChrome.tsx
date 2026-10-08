import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { formatArea, formatCount } from '../lib/format.js';
import { SearchBox } from './SearchBox.js';
import { ImageryNotice } from './Notice.js';
import { Inspector } from './Inspector.js';
import { PoolList } from './PoolList.js';
import { AreaSection, DrawSection, ListSection, ProgressSection, SavedScans, SummarySection, ThresholdSection } from './Sections.js';
import { usePools } from './hooks.js';
import { useUi } from './uiState.js';
import { IconList, IconSliders } from './icons.js';

/** Phone: the map stays full screen; search on top, a sheet at the bottom. */
export function PhoneChrome({ sourceName }: { sourceName: string | null }) {
  const phase = useStore((s) => s.phase);
  const selectedId = useStore((s) => s.selectedId);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const sheetList = useUi((s) => s.sheetList);
  const setSheetList = useUi((s) => s.setSheetList);
  const { shown, newest } = usePools();
  const [collapsed, setCollapsed] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const live = phase === 'scanning' || phase === 'paused';

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--sheet-h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (phase !== 'complete') setSheetList(false);
  }, [phase, setSheetList]);

  const total = shown.reduce((a, d) => a + d.areaM2, 0);

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
        <div className="sub-h">
          <h2>Found so far</h2>
          <span>{formatCount(shown.length)} pools</span>
        </div>
        <PoolList pools={shown} newest={newest} label="Pools found so far" limit={2} headers={false} />
      </>
    );
  } else if (sheetList) {
    body = (
      <>
        <ThresholdSection />
        <ListSection onPick={() => setSheetList(false)} />
      </>
    );
  } else if (selectedId) {
    body = <Inspector phone sourceName={sourceName} />;
  } else {
    body = <SummarySection />;
  }

  return (
    <>
      <div className="float-top">
        <SearchBox placeholder="Search a place" />
        <button className="icon-btn float" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <IconSliders />
        </button>
      </div>
      {phase === 'complete' && (
        <button
          className="pill"
          aria-expanded={sheetList}
          onClick={() => {
            setCollapsed(false);
            setSheetList(!sheetList);
          }}
        >
          <IconList />
          <b>{formatCount(shown.length)}</b> {shown.length === 1 ? 'pool' : 'pools'} · {formatArea(total)}
        </button>
      )}
      <div className={`sheet${collapsed ? ' collapsed' : ''}${sheetList ? ' tall' : ''}`} ref={sheetRef}>
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
    </>
  );
}
