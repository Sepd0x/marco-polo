export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  if (m2 >= 100) return `${Math.round(m2)} m²`;
  return `${m2.toFixed(1)} m²`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatLatLon(lat: number, lon: number, decimals = 5): string {
  return `${lat.toFixed(decimals)}, ${lon.toFixed(decimals)}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Approximate pool dimensions from area assuming a ~2:1 rectangle. */
export function approxDims(areaM2: number): string {
  const w = Math.sqrt(areaM2 / 2);
  return `≈ ${(2 * w).toFixed(1)} × ${w.toFixed(1)} m`;
}
