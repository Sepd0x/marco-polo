/**
 * Shareable area links. Version 2 carries the area and, optionally, a fixed
 * source: `#aoi=<base64url of {"v":2,"r":[[lon,lat],...],"s":"pnoa"}>`.
 * Version 1 links (`[zoom, ring]`) still open; their zoom is ignored, since
 * each source scans at its own resolution. Opening a link never changes the
 * settings of whoever opens it, and the area is applied once the map is ready.
 */
import { coversArea, findProvider, ringAreaM2, ringBBox, segmentsIntersect, type Ring } from '@marco-polo/core';
import { useStore } from '../state/store.js';
import { on } from './bus.js';

export interface Permalink {
  ring: Ring;
  /** A scan-allowed source covering the whole area, or null for auto. */
  source: string | null;
}

const MAX_POINTS = 200;
const MAX_LAT = 85.05;
/** Areas below this are a click, not a drawn area, m². */
const MIN_AREA_M2 = 1;

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function encodePermalink(ring: Ring, source: string | null = null): string {
  const doc: { v: 2; r: [number, number][]; s?: string } = { v: 2, r: ring.map(([lon, lat]) => [round6(lon), round6(lat)]) };
  if (source) doc.s = source;
  return `#aoi=${b64urlEncode(JSON.stringify(doc))}`;
}

/** True when no two non-adjacent edges cross. */
function simple(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];
      if (segmentsIntersect(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1], b2[0], b2[1])) return false;
    }
  }
  return true;
}

/**
 * A ring brought onto the world copy at -180 to 180. MapLibre gives
 * longitudes past 180 once the camera has crossed the antimeridian (Japan to
 * Hawaii), and the tile grid clamps them, so such a ring would plan no tile.
 * The whole ring moves by whole turns, its middle onto the main copy; a ring
 * that still crosses 180 is not drawable here, so null.
 */
export function wrapRing(ring: Ring): Ring | null {
  if (!ring.length) return null;
  const box = ringBBox(ring);
  const turns = Math.round((box.west + box.east) / 2 / 360);
  const out: Ring = ring.map(([lon, lat]) => [turns ? lon - turns * 360 : lon, lat]);
  for (const [lon] of out) if (!(Math.abs(lon) <= 180)) return null;
  return out;
}

/** A ring from untrusted JSON, or null when anything about it is off. */
export function validRing(raw: unknown): Ring | null {
  if (!Array.isArray(raw)) return null;
  const pts: Ring = [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length !== 2) return null;
    const [lon, lat] = c;
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    // Longitudes from a world copy are taken and wrapped below.
    if (Math.abs(lon) > 540 || Math.abs(lat) > MAX_LAT) return null;
    pts.push([lon, lat]);
  }
  // A closing point repeating the first is dropped.
  if (pts.length > 1) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  if (pts.length < 3 || pts.length > MAX_POINTS) return null;
  const wrapped = wrapRing(pts);
  if (!wrapped) return null;
  pts.splice(0, pts.length, ...wrapped);
  const box = ringBBox(pts);
  // Rings across the antimeridian are not drawable here.
  if (box.east - box.west > 180) return null;
  if (!(ringAreaM2(pts) >= MIN_AREA_M2)) return null;
  if (!simple(pts)) return null;
  return pts;
}

/** Read a link from a URL hash. Never throws; null when there is nothing valid. */
export function decodePermalink(hash: string): Permalink | null {
  const m = /#aoi=([A-Za-z0-9_-]{1,20000})(?:&|$)/.exec(hash);
  if (!m) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(b64urlDecode(m[1]));
  } catch {
    return null;
  }
  let ringRaw: unknown;
  let sourceRaw: unknown = null;
  if (Array.isArray(doc)) {
    // v1: [zoom, ring]. The zoom is read and dropped.
    if (doc.length !== 2) return null;
    ringRaw = doc[1];
  } else if (doc && typeof doc === 'object' && (doc as { v?: unknown }).v === 2) {
    ringRaw = (doc as { r?: unknown }).r;
    sourceRaw = (doc as { s?: unknown }).s ?? null;
  } else {
    return null;
  }
  const ring = validRing(ringRaw);
  if (!ring) return null;
  let source: string | null = null;
  if (typeof sourceRaw === 'string') {
    const p = findProvider(sourceRaw);
    if (p?.scanAllowed && coversArea(p, ring)) source = p.id;
  }
  return { ring, source };
}

export function writePermalink(ring: Ring | null, source: string | null = null): void {
  const url = new URL(window.location.href);
  url.hash = ring ? encodePermalink(ring, source) : '';
  history.replaceState(history.state, '', url);
}

/**
 * Restore the area of an opened link once the map is ready, then keep the URL
 * in step with the drawn area. Returns a function that stops both.
 */
export function bindPermalink(): () => void {
  let pending = decodePermalink(window.location.hash);
  let ready = false;
  const apply = () => {
    const shared = pending;
    pending = null;
    if (!shared) return;
    const s = useStore.getState();
    if (s.phase === 'scanning' || s.phase === 'paused') return;
    if (JSON.stringify(s.area) === JSON.stringify(shared.ring) && (s.areaSource ?? null) === (shared.source ?? null)) return;
    // The map fits itself to a new area.
    s.setArea(shared.ring, null, { source: shared.source });
  };
  const offReady = on('mapready', () => {
    if (ready) return;
    ready = true;
    apply();
  });
  // A link pasted into the address bar of an open tab only changes the hash.
  const onHash = () => {
    pending = decodePermalink(window.location.hash);
    if (ready) apply();
  };
  window.addEventListener('hashchange', onHash);
  const offArea = useStore.subscribe(
    (s) => [s.area, s.areaSource] as const,
    ([area, source]) => writePermalink(area, source),
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
  );
  return () => {
    offReady();
    window.removeEventListener('hashchange', onHash);
    offArea();
  };
}

/** Older name, kept for callers that only want the ring. */
export function decodeAoi(hash: string): { ring: Ring } | null {
  const p = decodePermalink(hash);
  return p ? { ring: p.ring } : null;
}
