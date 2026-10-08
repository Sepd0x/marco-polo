import { crc32, deflateSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';

/** One flat colour per source, so a pixel tells which source drew it. */
export const COLOURS = {
  dgt: [220, 40, 40],
  pnoa: [40, 180, 70],
  ign: [230, 200, 30],
  esri: [40, 70, 220],
} as const;
export type SourceKey = keyof typeof COLOURS;

const HOSTS: [RegExp, SourceKey][] = [
  [/^https:\/\/(cartografia|ortos)\.dgterritorio\.gov\.pt\//, 'dgt'],
  [/^https:\/\/www\.ign\.es\/wmts\//, 'pnoa'],
  [/^https:\/\/data\.geopf\.fr\/wmts/, 'ign'],
  [/^https:\/\/server\.arcgisonline\.com\//, 'esri'],
];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A flat RGB PNG. */
export function flatPng(size: number, [r, g, b]: readonly number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) row.set([r, g, b], 1 + i * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function sourceOf(url: string): SourceKey | null {
  for (const [re, key] of HOSTS) if (re.test(url)) return key;
  return null;
}

const HALF = 20037508.342789244;

/** Tile zoom of an imagery request, from its z parameter or its WMS bbox. */
export function tileZoom(url: string): number | null {
  let m = /World_Imagery\/MapServer\/tile\/(\d+)\//.exec(url);
  if (m) return Number(m[1]);
  m = /tilematrix=(\d+)/i.exec(url);
  if (m) return Number(m[1]);
  m = /BBOX=([-\d.]+),[-\d.]+,([-\d.]+),/i.exec(url);
  if (m) return Math.log2((2 * HALF) / (Number(m[2]) - Number(m[1])));
  return null;
}

/**
 * Answers the imagery hosts with flat tiles and OpenFreeMap with an empty
 * tileset; anything else outside localhost is refused.
 */
export async function serveTiles(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) => {
    const url = route.request().url();
    if (url.endsWith('/planet')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }),
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0), headers: { 'access-control-allow-origin': '*' } });
  });
  for (const [re, key] of HOSTS) {
    await page.route(re, (route) => {
      const url = route.request().url();
      const w = /[?&]WIDTH=(\d+)/i.exec(url);
      return route.fulfill({
        contentType: 'image/png',
        body: flatPng(w ? Number(w[1]) : 256, COLOURS[key]),
        headers: { 'access-control-allow-origin': '*' },
      });
    });
  }
}

/** Collects imagery requests made by the page. */
export function recordImagery(page: Page): { list: { source: SourceKey; z: number | null; url: string }[] } {
  const rec = { list: [] as { source: SourceKey; z: number | null; url: string }[] };
  page.on('request', (r: Request) => {
    const source = sourceOf(r.url());
    if (source) rec.list.push({ source, z: tileZoom(r.url()), url: r.url() });
  });
  return rec;
}
