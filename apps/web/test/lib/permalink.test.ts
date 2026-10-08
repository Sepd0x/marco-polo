import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindPermalink, decodePermalink, encodePermalink, validRing } from '../../src/lib/permalink.js';
import { emit, resetSticky } from '../../src/lib/bus.js';
import { SETTINGS_KEY } from '../../src/state/settings.js';
import { useStore } from '../../src/state/store.js';
import { PT_AREA, resetStore, US_AREA } from '../scan/harness.js';

function v1Link(zoom: unknown, ring: unknown): string {
  const b64 = btoa(JSON.stringify([zoom, ring])).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `#aoi=${b64}`;
}

function raw(doc: unknown): string {
  return `#aoi=${btoa(JSON.stringify(doc)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

beforeEach(() => {
  resetStore();
  resetSticky();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  resetSticky();
});

describe('permalink', () => {
  it('round-trips an area and a fixed source', () => {
    const link = encodePermalink(PT_AREA, 'dgt-ortos2025');
    const back = decodePermalink(link)!;
    expect(back.source).toBe('dgt-ortos2025');
    expect(back.ring).toHaveLength(4);
    back.ring.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(PT_AREA[i][0], 6);
      expect(lat).toBeCloseTo(PT_AREA[i][1], 6);
    });
  });

  it('opens v1 links with any zoom and ignores the zoom', () => {
    for (const zoom of [18.5, 12, 20, 19]) {
      const p = decodePermalink(v1Link(zoom, US_AREA));
      expect(p?.ring).toEqual(US_AREA);
      expect(p?.source).toBeNull();
    }
  });

  it('opening a link never changes the settings of whoever opens it', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(useStore.getState().settings));
    const before = localStorage.getItem(SETTINGS_KEY);
    const settings = useStore.getState().settings;
    history.replaceState(null, '', `/${v1Link(18.5, US_AREA)}`);
    const off = bindPermalink();
    emit('mapready', {});
    expect(useStore.getState().area).toEqual(US_AREA);
    expect(useStore.getState().settings).toBe(settings);
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before);
    off();
  });

  it('applies the area only once the map is ready', () => {
    history.replaceState(null, '', `/${encodePermalink(US_AREA)}`);
    const off = bindPermalink();
    expect(useStore.getState().area).toBeNull();
    emit('mapready', {});
    expect(useStore.getState().area).toEqual(US_AREA);
    expect(useStore.getState().phase).toBe('ready');
    off();
  });

  it('applies at once when the map was ready first', () => {
    emit('mapready', {});
    history.replaceState(null, '', `/${encodePermalink(US_AREA)}`);
    const off = bindPermalink();
    expect(useStore.getState().area).toEqual(US_AREA);
    off();
  });

  it('keeps the URL in step with the drawn area', () => {
    const off = bindPermalink();
    useStore.getState().setArea(PT_AREA);
    expect(decodePermalink(window.location.hash)?.ring).toHaveLength(4);
    useStore.getState().setArea(null);
    expect(window.location.hash).toBe('');
    off();
  });

  it('drops a source that cannot scan or does not cover the area', () => {
    expect(decodePermalink(encodePermalink(US_AREA, 'pnoa'))?.source).toBeNull();
    expect(decodePermalink(encodePermalink(PT_AREA, 'dgt-ortosat2023'))?.source).toBeNull();
    expect(decodePermalink(encodePermalink(PT_AREA, 'mapbox'))?.source).toBeNull();
  });

  it('refuses malformed and hostile links', () => {
    const bad = [
      '#aoi=%%%',
      '#aoi=bm90IGpzb24',
      raw({ v: 3, r: US_AREA }),
      raw({ v: 2, r: 'x' }),
      raw({ v: 2, r: [[0, 0], [1, 1]] }),
      raw({ v: 2, r: [[0, 0], [0, 0], [0, 0]] }),
      raw({ v: 2, r: [[0, 0], [1, 0], [1, 'a']] }),
      raw({ v: 2, r: [[0, 0], [1, 0], [1, 91]] }),
      raw({ v: 2, r: [[0, 0], [181, 0], [1, 1]] }),
      raw({ v: 2, r: [[0, 0], [1, 1], [1, 0], [0, 1]] }), // bow tie
      raw({ v: 2, r: Array.from({ length: 201 }, (_, i) => [Math.cos(i / 32), Math.sin(i / 32)]) }),
      raw({ v: 2, r: [[-179, 0], [179, 0], [179, 1], [-179, 1]] }),
      v1Link(19, null),
    ];
    for (const h of bad) expect(decodePermalink(h)).toBeNull();
    expect(validRing([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]])).toHaveLength(3);
  });
});
