import { useId, useRef, useState } from 'react';
import { emit } from '../lib/bus.js';
import { formatDegrees } from '../map/frame.js';
import { IconSearch } from './icons.js';
import { nominatimUrl, parseCoordinates, parseNominatim, type Place } from './search.js';

/**
 * Place search through Nominatim (OpenStreetMap). A query goes out on Enter
 * only, as its usage policy asks; coordinates never leave the page.
 */
export function SearchBox({ placeholder = 'Search a place or paste coordinates', shortcut = false }: { placeholder?: string; shortcut?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const done = () => {
    setResults(null);
    setQuery('');
    inputRef.current?.blur();
  };

  async function search() {
    const q = query.trim();
    if (!q || status === 'busy') return;
    const coords = parseCoordinates(q);
    if (coords) {
      emit('flyto', { center: [coords.lon, coords.lat], zoom: 17 });
      done();
      return;
    }
    setStatus('busy');
    try {
      const res = await fetch(nominatimUrl(q), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      setResults(parseNominatim(await res.json()));
      setStatus('idle');
    } catch {
      setResults([]);
      setStatus('failed');
    }
  }

  function pick(p: Place) {
    if (p.bbox) emit('flyto', { bbox: p.bbox });
    else emit('flyto', { center: [p.lon, p.lat], zoom: 16 });
    done();
  }

  return (
    <div className="search">
      <label className="search-field">
        <span className="sr-only">Search a place</span>
        <IconSearch />
        <input
          ref={inputRef}
          type="search"
          placeholder={status === 'busy' ? 'Searching' : placeholder}
          value={query}
          autoComplete="off"
          aria-keyshortcuts={shortcut ? '/' : undefined}
          aria-controls={results ? listId : undefined}
          aria-expanded={results ? true : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setResults(null);
            }
          }}
        />
        {shortcut && (
          <kbd className="search-key" aria-hidden="true">
            /
          </kbd>
        )}
      </label>
      {results && (
        <div className="search-results" id={listId}>
          {results.length === 0 && (
            <p className="note">{status === 'failed' ? 'The search did not answer. Try again.' : 'No places found.'}</p>
          )}
          {results.map((r, i) => (
            <button key={i} className="result" onClick={() => pick(r)} title={r.name}>
              <span className="result-name">{r.name}</span>
              <span className="result-sub">
                {formatDegrees(r.lat, 4)}, {formatDegrees(r.lon, 4)}
              </span>
            </button>
          ))}
          <p className="credit">Search by OpenStreetMap Nominatim</p>
        </div>
      )}
    </div>
  );
}
