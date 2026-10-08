/** Place search: coordinates typed by hand, or a Nominatim answer checked field by field. */

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** west, south, east, north */
  bbox: [number, number, number, number] | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "37.0745, -8.1155" or "37.0745 -8.1155". Returns null for anything else or out of range. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Keep only well-formed results; anything odd in the response is dropped, never trusted. */
export function parseNominatim(json: unknown, limit = 5): Place[] {
  if (!Array.isArray(json)) return [];
  const out: Place[] = [];
  for (const r of json) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.display_name === 'string' ? o.display_name.slice(0, 200) : null;
    const lat = num(o.lat);
    const lon = num(o.lon);
    if (!name || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    let bbox: Place['bbox'] = null;
    if (Array.isArray(o.boundingbox) && o.boundingbox.length === 4) {
      const [s, n, w, e] = o.boundingbox.map(num);
      if (s != null && n != null && w != null && e != null && s <= n && w <= e) bbox = [w, s, e, n];
    }
    out.push({ name, lat, lon, bbox });
    if (out.length >= limit) break;
  }
  return out;
}

export function nominatimUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
}
