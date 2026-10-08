import type { OrientedDims } from '@marco-polo/core';

const EN = 'en-US';

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString(EN);
}

/** Pool-sized areas: "8.5 m²", "100 m²", "1,367 m²". */
export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(1)} ha`;
  if (m2 >= 10) return `${formatCount(m2)} m²`;
  return `${m2.toFixed(1)} m²`;
}

/** Land areas, the drawn shape: "0.4 ha", "13.1 ha", "2.35 km²". */
export function formatLandArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  return `${(m2 / 10_000).toFixed(1)} ha`;
}

/** "9 s", "2 min 5 s", "1 h 4 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  const sec = s % 60;
  return sec > 0 ? `${m} min ${sec} s` : `${m} min`;
}

/** Time left, rounded so it does not flicker: "About 3 s left", "About 4 min left". */
export function formatTimeLeft(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return 'Working out the time left';
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `About ${s} s left`;
  const m = Math.round(s / 60);
  if (m < 60) return `About ${m} min left`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest > 0 ? `About ${h} h ${rest} min left` : `About ${h} h left`;
}

export function formatLatLon(lat: number, lon: number, decimals = 5): string {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}

/** Detector score, never shown as a percentage: it is not a calibrated probability. */
export function formatScore(score: number): string {
  return score.toFixed(2);
}

/** Length by width from the measured outline, or a plain statement that there is none. */
export function formatDims(dims: OrientedDims | null): string {
  if (!dims) return 'Size not measured';
  return `${dims.lengthM.toFixed(1)} × ${dims.widthM.toFixed(1)} m`;
}

/** Ground resolution: "25 cm", "1.5 m". */
export function formatResolution(m: number | null): string | null {
  if (m == null) return null;
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return `${m.toFixed(1)} m`;
}

/** "today at 14:32", "yesterday at 09:05", "3 Oct at 18:40". */
export function formatWhen(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return `today at ${time}`;
  if (day(ts) === day(now - 86_400_000)) return `yesterday at ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} at ${time}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Capture date as published ("2025", "2023-09") in words: "2025", "Sep 2023". */
export function formatCaptureDate(date: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return date;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
