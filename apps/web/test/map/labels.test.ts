import { describe, expect, it } from 'vitest';
import { FONT_REGULAR, labelLayers } from '../../src/map/labels.js';

/** Every number in a text-size value: the sizes a constant or a match can give. */
function sizes(v: unknown): number[] {
  if (typeof v === 'number') return [v];
  return Array.isArray(v) ? v.flatMap(sizes) : [];
}

describe('map labels', () => {
  const layers = labelLayers() as { id: string; layout: Record<string, unknown> }[];

  it('use one regular face and no text under 12 px', () => {
    for (const l of layers) {
      expect(l.layout['text-font'], l.id).toEqual(FONT_REGULAR);
      for (const s of sizes(l.layout['text-size'])) expect(s, l.id).toBeGreaterThanOrEqual(12);
    }
  });

  it('keep places at 13 px at most, streets and house numbers at 12 px, as written', () => {
    const by = Object.fromEntries(layers.map((l) => [l.id, l.layout]));
    expect(by['lbl-place']['text-size']).toEqual(['match', ['get', 'class'], ['city', 'town'], 13, 12]);
    expect(by['lbl-place']['text-transform']).toBe('none');
    expect(by['lbl-street']['text-size']).toBe(12);
    expect(by['lbl-street']['text-transform']).toBe('none');
    expect(by['lbl-housenumber']['text-size']).toBe(12);
  });
});
