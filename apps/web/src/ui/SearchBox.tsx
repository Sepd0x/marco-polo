import { useRef, useState } from 'react';
import { emit } from '../lib/bus.js';

interface Result {
  display_name: string;
  boundingbox: [string, string, string, string]; // south, north, west, east
  lat: string;
  lon: string;
}

/**
 * Place search via Nominatim (OpenStreetMap). Queries fire on Enter only, in
 * line with the public usage policy — this is navigation, not autocomplete.
 */
export function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function search() {
    const q = query.trim();
    if (!q || busy) return;
    // Direct coordinates ("lat, lon") skip geocoding entirely.
    const coord = /^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/.exec(q);
    if (coord) {
      const lat = Number(coord[1]);
      const lon = Number(coord[2]);
      if (Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
        emit('flyto', { center: [lon, lat], zoom: 16 });
        setQuery('');
        inputRef.current?.blur();
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } },
      );
      setResults((await res.json()) as Result[]);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  function pick(r: Result) {
    const [s, n, w, e] = r.boundingbox.map(Number);
    emit('flyto', { bbox: [w, s, e, n] });
    setResults(null);
    setQuery('');
    inputRef.current?.blur();
  }

  return (
    <div className="search-wrap">
      <input
        ref={inputRef}
        className="field"
        placeholder={busy ? 'searching…' : 'goto place / lat,lon ⏎'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void search();
          if (e.key === 'Escape') setResults(null);
        }}
      />
      {results && (
        <div className="search-results panel">
          {results.length === 0 && <div className="credit">no results</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)}>
              {r.display_name}
            </button>
          ))}
          <div className="credit">search © OpenStreetMap / Nominatim</div>
        </div>
      )}
    </div>
  );
}
