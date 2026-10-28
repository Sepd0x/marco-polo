import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_REGULAR, glyphsUrl } from '../../src/map/labels.js';
// @ts-expect-error plain .mjs build script, no types
import { decodeRange } from '../../scripts/glyphs.mjs';

const dir = join(__dirname, '../../public/glyphs', FONT_REGULAR[0]);
const at = (f: string) => join(dir, f);

describe('map glyphs', () => {
  it('come from the app origin under the base path, braces unencoded', () => {
    expect(glyphsUrl('https://sepd0x.github.io', '/marco-polo/')).toBe('https://sepd0x.github.io/marco-polo/glyphs/{fontstack}/{range}.pbf');
    expect(glyphsUrl('http://localhost:5173', '/')).toBe('http://localhost:5173/glyphs/{fontstack}/{range}.pbf');
    expect(glyphsUrl('http://localhost:5173', '/x')).toBe('http://localhost:5173/x/glyphs/{fontstack}/{range}.pbf');
  });

  it('ship every range, with the font licence beside them', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.pbf'));
    expect(files).toHaveLength(256);
    expect(existsSync(at('OFL.txt'))).toBe(true);
    expect(readFileSync(at('OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });

  it('cover printable ASCII and Latin-1, Portuguese, Spanish and French accents included', () => {
    const r = decodeRange(readFileSync(at('0-255.pbf')));
    expect(r.name).toBe(FONT_REGULAR[0]);
    expect(r.range).toBe('0-255');
    const ids = new Set(r.glyphs.map((g: { id: number }) => g.id));
    for (let c = 0x20; c < 0x7f; c++) expect(ids.has(c), String.fromCharCode(c)).toBe(true);
    for (let c = 0xa0; c <= 0xff; c++) expect(ids.has(c), String.fromCharCode(c)).toBe(true);
    for (const ch of 'ãõçáéíóúâêôàüñ¿¡èëîïûÇÃÉ') expect(ids.has(ch.codePointAt(0)), ch).toBe(true);
  });

  it('hold a bitmap of (width + 6) x (height + 6) bytes, as MapLibre reads a 3 px border', () => {
    const r = decodeRange(readFileSync(at('0-255.pbf')));
    for (const g of r.glyphs as { id: number; bitmap: number; width: number; height: number }[]) {
      if (g.width === 0) expect(g.bitmap, String(g.id)).toBe(0);
      else expect(g.bitmap, String(g.id)).toBe((g.width + 6) * (g.height + 6));
    }
  });

  it('have Latin Extended-A for other European names', () => {
    const r = decodeRange(readFileSync(at('256-511.pbf')));
    const ids = new Set(r.glyphs.map((g: { id: number }) => g.id));
    for (const ch of 'œŒąćęłńśźżőűşğı') expect(ids.has(ch.codePointAt(0)), ch).toBe(true);
  });
});
