import { describe, expect, it } from 'vitest';
import { cleanMask, dilate, erode, labelComponents } from '../src/detect/mask.js';

function maskFrom(rows: string[]): { mask: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) if (row[x] === '#') mask[y * w + x] = 1;
  });
  return { mask, w, h };
}

describe('morphology and labelling', () => {
  it('erode strips a 1px boundary', () => {
    const { mask, w, h } = maskFrom([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
    const e = erode(mask, w, h);
    expect(Array.from(e).reduce((a, b) => a + b, 0)).toBe(1);
    expect(e[2 * w + 2]).toBe(1);
  });

  it('dilate grows a cross', () => {
    const { mask, w, h } = maskFrom([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    const d = dilate(mask, w, h);
    expect(Array.from(d).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('cleanMask removes isolated speckle', () => {
    const { mask, w, h } = maskFrom([
      '#.........',
      '..........',
      '...#####..',
      '...#####..',
      '...#####..',
      '...#####..',
      '...#####..',
      '..........',
      '.......#..',
      '..........',
    ]);
    const cleaned = cleanMask(mask, w, h);
    expect(cleaned[0]).toBe(0); // speckle gone
    expect(cleaned[8 * w + 7]).toBe(0);
    expect(cleaned[4 * w + 5]).toBe(1); // blob core survives
  });

  it('labels separate components with stats', () => {
    const { mask, w, h } = maskFrom([
      '##....',
      '##....',
      '......',
      '....##',
      '....##',
    ]);
    const { components } = labelComponents(mask, w, h);
    expect(components).toHaveLength(2);
    const [a, b] = components;
    expect(a.pixelCount).toBe(4);
    expect(a.minX).toBe(0);
    expect(a.maxX).toBe(1);
    expect(b.pixelCount).toBe(4);
    expect(b.minY).toBe(3);
    expect(b.maxY).toBe(4);
  });

  it('8-connectivity joins diagonal pixels', () => {
    const { mask, w, h } = maskFrom([
      '#.',
      '.#',
    ]);
    const { components } = labelComponents(mask, w, h);
    expect(components).toHaveLength(1);
    expect(components[0].pixelCount).toBe(2);
  });
});
