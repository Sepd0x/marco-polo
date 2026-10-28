#!/usr/bin/env node
/*
 * Builds the MapLibre glyph ranges the map labels use, from the interface
 * font, so the map and the interface share one face and the glyphs come from
 * the app's own origin.
 *
 *   node apps/web/scripts/glyphs.mjs            # writes apps/web/public/glyphs/
 *   node apps/web/scripts/glyphs.mjs --decode F # prints the metrics of a .pbf
 *
 * The glyphs are signed distance fields as MapLibre expects them from a glyph
 * server: 24 px, 3 px buffer, radius 8, cutoff 0.25. They are drawn by
 * TinySDF (the rasteriser MapLibre itself uses for local glyphs) in headless
 * Chromium, with Martian Mono at width 75 and weight 400, the interface
 * setting. Every one of the 256 ranges is written, the ones the font does not
 * cover as empty ranges, so a label with a character outside the font loses
 * that character and never its tile.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const require = createRequire(import.meta.url);

export const STACK = 'Martian Mono Regular';
const FONT = join(web, 'src/styles/fonts/MartianMono-VF-latin.woff2');
const OFL = join(web, 'src/styles/fonts/MartianMono-OFL.txt');
const OUT = join(web, 'public/glyphs', STACK);

const SIZE = 24;
const BUFFER = 3;
const RADIUS = 8;
const CUTOFF = 0.25;
/**
 * Server glyphs carry `top` as the ink top above the baseline less 26 px.
 * Read off the OpenFreeMap Noto Sans 0-255 range: the space has top -26,
 * the full stop (3 px tall) -23, x (13 px) -13, H (17 px) -9.
 */
const TOP_SHIFT = 26;

/* WOFF2: just enough to read the cmap. */

function base128(buf, at) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[at.i++];
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error('bad UIntBase128');
}

function woff2Tables(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  const at = { i: 48 };
  const dir = [];
  for (let t = 0; t < numTables; t++) {
    const flags = buf[at.i++];
    const index = flags & 0x3f;
    let tag = String(index);
    if (index === 63) {
      tag = buf.toString('latin1', at.i, at.i + 4);
      at.i += 4;
    } else if (index === 0) tag = 'cmap';
    const version = flags >> 6;
    const orig = base128(buf, at);
    const glyfLoca = index === 10 || index === 11;
    const transformed = glyfLoca ? version === 0 : version !== 0;
    const length = transformed ? base128(buf, at) : orig;
    dir.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(at.i, at.i + compressed));
  const tables = {};
  let off = 0;
  for (const t of dir) {
    tables[t.tag] = data.subarray(off, off + t.length);
    off += t.length;
  }
  return tables;
}

function cmapCodepoints(cmap) {
  const n = cmap.readUInt16BE(2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const p = cmap.readUInt16BE(4 + i * 8);
    const e = cmap.readUInt16BE(6 + i * 8);
    const o = cmap.readUInt32BE(8 + i * 8);
    subs.push({ p, e, o, format: cmap.readUInt16BE(o) });
  }
  const pick = subs.find((s) => s.format === 12) ?? subs.find((s) => s.format === 4);
  if (!pick) throw new Error('no usable cmap subtable');
  const out = new Set();
  const o = pick.o;
  if (pick.format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const start = cmap.readUInt32BE(o + 16 + g * 12);
      const end = cmap.readUInt32BE(o + 20 + g * 12);
      for (let c = start; c <= end; c++) out.add(c);
    }
  } else {
    const seg = cmap.readUInt16BE(o + 6) / 2;
    const ends = o + 14;
    const starts = ends + seg * 2 + 2;
    const deltas = starts + seg * 2;
    const ranges = deltas + seg * 2;
    for (let s = 0; s < seg; s++) {
      const end = cmap.readUInt16BE(ends + s * 2);
      const start = cmap.readUInt16BE(starts + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const ro = cmap.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const gid = ro === 0 ? (c + delta) & 0xffff : cmap.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2);
        if (gid !== 0) out.add(c);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/* Protocol buffers: the glyph schema has varints, zigzag varints, strings and bytes. */

function varint(n) {
  const out = [];
  let v = n >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

const zigzag = (n) => (n << 1) ^ (n >> 31);
const key = (field, wire) => varint((field << 3) | wire);

function lenField(field, bytes) {
  return [...key(field, 2), ...varint(bytes.length), ...bytes];
}

function encodeGlyph(g) {
  const out = [...key(1, 0), ...varint(g.id)];
  if (g.bitmap && g.bitmap.length) out.push(...lenField(2, g.bitmap));
  out.push(...key(3, 0), ...varint(g.width));
  out.push(...key(4, 0), ...varint(g.height));
  out.push(...key(5, 0), ...varint(zigzag(g.left)));
  out.push(...key(6, 0), ...varint(zigzag(g.top)));
  out.push(...key(7, 0), ...varint(g.advance));
  return out;
}

export function encodeRange(name, start, glyphs) {
  const range = `${start}-${start + 255}`;
  const stack = [...lenField(1, [...Buffer.from(name)]), ...lenField(2, [...Buffer.from(range)])];
  for (const g of glyphs) stack.push(...lenField(3, encodeGlyph(g)));
  return Buffer.from(lenField(1, stack));
}

function readVarint(buf, at) {
  let v = 0;
  let shift = 0;
  for (;;) {
    const b = buf[at.i++];
    v += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return v;
    shift += 7;
  }
}

function readMessage(buf, fn) {
  const at = { i: 0 };
  while (at.i < buf.length) {
    const k = readVarint(buf, at);
    const field = Math.floor(k / 8);
    const wire = k & 7;
    if (wire === 0) fn(field, readVarint(buf, at));
    else if (wire === 2) {
      const n = readVarint(buf, at);
      fn(field, buf.subarray(at.i, at.i + n));
      at.i += n;
    } else throw new Error(`wire type ${wire}`);
  }
}

const unzig = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

export function decodeRange(buf) {
  const res = { name: '', range: '', glyphs: [] };
  readMessage(buf, (f, v) => {
    if (f !== 1) return;
    readMessage(v, (ff, vv) => {
      if (ff === 1) res.name = Buffer.from(vv).toString();
      else if (ff === 2) res.range = Buffer.from(vv).toString();
      else if (ff === 3) {
        const g = { bitmap: 0 };
        readMessage(vv, (k, x) => {
          if (k === 1) g.id = x;
          else if (k === 2) g.bitmap = x.length;
          else if (k === 3) g.width = x;
          else if (k === 4) g.height = x;
          else if (k === 5) g.left = unzig(x);
          else if (k === 6) g.top = unzig(x);
          else if (k === 7) g.advance = x;
        });
        res.glyphs.push(g);
      }
    });
  });
  return res;
}

/* Drawing, in Chromium with the font loaded from the file. */

async function drawGlyphs(codepoints) {
  const { chromium } = require('@playwright/test');
  const sdfSource = readFileSync(require.resolve('@mapbox/tiny-sdf'), 'utf8').replace('export default class TinySDF', 'window.TinySDF = class TinySDF');
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>glyphs</title>');
    await page.addScriptTag({ content: sdfSource });
    const font = readFileSync(FONT).toString('base64');
    return await page.evaluate(
      async ({ font, codepoints, SIZE, BUFFER, RADIUS, CUTOFF }) => {
        const bytes = Uint8Array.from(atob(font), (c) => c.charCodeAt(0));
        const face = new FontFace('Glyph Source', bytes, { weight: '100 800', stretch: '75% 112.5%' });
        await face.load();
        document.fonts.add(face);
        const sdf = new window.TinySDF({ fontSize: SIZE, buffer: BUFFER, radius: RADIUS, cutoff: CUTOFF, fontFamily: '"Glyph Source"', fontWeight: '400' });
        // Setting the font resets the stretch, so the stretch goes second.
        sdf.ctx.font = `normal 400 ${SIZE}px "Glyph Source"`;
        if (!sdf.ctx.font.includes('Glyph Source')) throw new Error('font not taken');
        const wide = sdf.ctx.measureText('0').width;
        sdf.ctx.fontStretch = 'condensed';
        if (!(sdf.ctx.measureText('0').width < wide)) throw new Error('width 75 not taken');
        const out = [];
        for (const id of codepoints) {
          const g = sdf.draw(String.fromCodePoint(id));
          out.push({
            id,
            width: g.glyphWidth,
            height: g.glyphHeight,
            left: g.glyphLeft,
            top: g.glyphTop,
            advance: g.glyphAdvance,
            bitmap: g.glyphWidth && g.glyphHeight ? Array.from(g.data) : [],
          });
        }
        return out;
      },
      { font, codepoints, SIZE, BUFFER, RADIUS, CUTOFF },
    );
  } finally {
    await browser.close();
  }
}

async function build() {
  const cmap = woff2Tables(readFileSync(FONT)).cmap;
  // Controls have no glyph; the space and every printing character do.
  const codepoints = cmapCodepoints(cmap).filter((c) => c >= 0x20 && c <= 0xffff && !(c >= 0x7f && c < 0xa0));
  const drawn = await drawGlyphs(codepoints);
  const byRange = new Map();
  for (const g of drawn) {
    const glyph = {
      id: g.id,
      bitmap: g.bitmap,
      width: g.bitmap.length ? g.width : 0,
      height: g.bitmap.length ? g.height : 0,
      left: g.left,
      top: g.top - TOP_SHIFT,
      advance: Math.round(g.advance),
    };
    const start = Math.floor(g.id / 256) * 256;
    if (!byRange.has(start)) byRange.set(start, []);
    byRange.get(start).push(glyph);
  }
  mkdirSync(OUT, { recursive: true });
  let bytes = 0;
  for (let start = 0; start < 65536; start += 256) {
    const buf = encodeRange(STACK, start, byRange.get(start) ?? []);
    writeFileSync(join(OUT, `${start}-${start + 255}.pbf`), buf);
    bytes += buf.length;
  }
  copyFileSync(OFL, join(OUT, 'OFL.txt'));
  console.log(`${codepoints.length} glyphs in ${byRange.size} ranges, 256 files, ${(bytes / 1024).toFixed(1)} KB -> ${OUT}`);
}

if (process.argv[2] === '--decode') {
  const r = decodeRange(readFileSync(process.argv[3]));
  console.log(r.name, r.range, r.glyphs.length, 'glyphs');
  const pick = process.argv.slice(4);
  for (const g of r.glyphs) if (!pick.length || pick.includes(String.fromCodePoint(g.id))) console.log(String.fromCodePoint(g.id), JSON.stringify(g));
} else {
  await build();
}
