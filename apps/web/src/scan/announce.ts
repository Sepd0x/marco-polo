/**
 * A polite live region that reads scan progress to screen readers at a pace
 * they can follow: start, each quarter, pause, resume and the end. Built on
 * the DOM directly so it works whatever panel is on screen.
 */
import { useStore, visibleRanked, type Phase, type ScanStats } from '../state/store.js';

let region: HTMLElement | null = null;
let stop: (() => void) | null = null;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Text for a moment of the scan, or null when nothing is worth saying. */
export function progressMessage(
  prev: { phase: Phase; stats: ScanStats } | null,
  next: { phase: Phase; stats: ScanStats; pools: number; sources: string[] },
): string | null {
  const { phase, stats } = next;
  if (phase === 'scanning' && prev?.phase !== 'scanning' && prev?.phase !== 'paused') {
    const via = next.sources.length ? ` on ${next.sources.join(' and ')}` : '';
    return `Scan started: ${plural(stats.tilesTotal, 'tile')}${via}.`;
  }
  if (phase === 'paused' && prev?.phase === 'scanning') return `Scan paused at ${percent(stats)}%.`;
  if (phase === 'scanning' && prev?.phase === 'paused') return 'Scan resumed.';
  if (phase === 'complete' && prev && prev.phase !== 'complete' && prev.phase !== 'idle') {
    const parts = [plural(next.pools, 'pool') + ' found'];
    if (stats.tilesFailed) parts.push(`${plural(stats.tilesFailed, 'tile')} failed`);
    if (stats.tilesNoCoverage) parts.push(`${plural(stats.tilesNoCoverage, 'tile')} without imagery`);
    return `${stats.stopped ? 'Scan stopped' : 'Scan complete'}: ${parts.join(', ')}.`;
  }
  if (phase === 'scanning' && prev && stats.tilesTotal > 0) {
    const before = Math.floor(percent(prev.stats) / 25);
    const now = Math.floor(percent(stats) / 25);
    if (now > before && now < 4) return `${now * 25}% scanned, ${plural(next.pools, 'pool')} so far.`;
  }
  return null;
}

function percent(stats: ScanStats): number {
  return stats.tilesTotal ? Math.floor((100 * stats.tilesDone) / stats.tilesTotal) : 0;
}

/** Mount the region once; later calls do nothing. Returns a function that removes it. */
export function startAnnouncer(): () => void {
  if (stop) return stop;
  if (typeof document === 'undefined') return () => {};
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.className = 'scan-announcer';
  // Visually hidden, still read. Set through CSSOM, which a style-src policy allows.
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  document.body.appendChild(region);

  let prev: { phase: Phase; stats: ScanStats } | null = null;
  const unsub = useStore.subscribe(
    (s) => ({ phase: s.phase, stats: s.stats, pools: visibleRanked(s).length, sources: s.parts.map((p) => p.providerName) }),
    (next) => {
      const text = progressMessage(prev, next);
      prev = { phase: next.phase, stats: next.stats };
      if (text && region) region.textContent = text;
    },
    { equalityFn: (a, b) => a.phase === b.phase && a.stats === b.stats && a.pools === b.pools },
  );
  stop = () => {
    unsub();
    region?.remove();
    region = null;
    stop = null;
  };
  return stop;
}
