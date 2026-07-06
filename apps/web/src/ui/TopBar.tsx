import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { formatCount } from '../lib/format.js';
import { SearchBox } from './SearchBox.js';
import { IconGear, IconGitHub } from './icons.js';

const REPO_URL = 'https://github.com/Sepd0x/marco-polo';

/** Full-width mission bar: identity, live status, UTC clock, search, controls. */
export function TopBar({
  settingsOpen,
  onToggleSettings,
}: {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const estimate = useStore((s) => s.areaEstimate);
  const pools = useStore((s) => s.ranked.length);

  let text: string;
  switch (phase) {
    case 'idle':
      text = 'standby — select aoi';
      break;
    case 'ready':
      text = estimate
        ? `aoi locked — ${formatCount(estimate.count)}${estimate.approximate ? '+' : ''} tiles`
        : 'aoi locked';
      break;
    case 'scanning':
      text = `sweeping ${formatCount(stats.tilesDone)}/${formatCount(stats.tilesTotal)}`;
      break;
    case 'paused':
      text = 'holding';
      break;
    case 'complete':
      text = `complete — ${formatCount(pools)} returns`;
      break;
  }

  return (
    <header className="topbar">
      <div className="tb-brand">
        MARCO<span className="dot-sep">·</span>POLO
      </div>
      <div className="tb-sub">SAT POOL SCANNER</div>
      <div className="tb-status">
        <span className={`status-dot ${phase}`} />
        <span className="mono">{text}</span>
      </div>
      <div className="tb-flex" />
      <SearchBox />
      <UtcClock />
      <button
        className={`tb-icon ${settingsOpen ? 'active' : ''}`}
        onClick={onToggleSettings}
        aria-label="Scanner settings"
        title="Settings"
      >
        <IconGear />
      </button>
      <a className="tb-icon" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" title="Source">
        <IconGitHub />
      </a>
    </header>
  );
}

function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return (
    <div className="tb-clock mono" title="Coordinated Universal Time">
      {hh}:{mm}:{ss}Z
    </div>
  );
}
