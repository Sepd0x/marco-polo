/**
 * Why did v1 miss a pool? For every missed label, find the first stage of the
 * packages/core pipeline that lost it:
 *
 *   colour gate   under 30% of the label's pixels pass the per-pixel water
 *                 test; the most common set of failed rules is named
 *   texture       the shape survives with the texture ceiling lifted
 *   size/shape    the shape survives with size and aspect filters lifted
 *   cleanup       pixels pass, but no component survives even unfiltered
 *                 (morphological opening erases thin or speckled water)
 *
 * This is mechanical and specific to the core detector; it complements the
 * by-eye appearance categories.
 */
import {
  buildScanPlan,
  DEFAULT_THRESHOLDS,
  expandBBoxMeters,
  lonLatToTile,
  rgbToHsv,
  tilePixelToLonLat,
  type Ring,
  type WaterThresholds,
} from '@marco-polo/core';
import { coreDetector } from './detectors.js';
import { pointInPolygons, distanceM } from './geom.js';
import type { TileSource } from './imagery.js';
import { hits } from './match.js';
import type { EvalDetection, Label } from './types.js';
import { SCAN_MARGIN_M } from './evaluate.js';
import type { Zone } from './zones.js';

const Z = 19;

/** The per-pixel rules of core's water gate (mirrors buildWaterMask), by name. */
export function failedRules(r: number, g: number, b: number, t: WaterThresholds = DEFAULT_THRESHOLDS): string[] {
  const { h, s, v } = rgbToHsv(r, g, b);
  const out: string[] = [];
  if (h < t.hueMin || h > t.hueMax) out.push(h < t.hueMin ? 'hue too green' : 'hue too blue');
  if (v < t.valMin) out.push('too dark');
  if (!(s >= t.satStrong || (s >= t.satMin && v >= t.valBright))) out.push('too pale');
  if (b - r < t.blueOverRed || g - r < t.greenOverRed) out.push('not blue over red');
  if (b - g < t.blueOverGreenMin) out.push('green over blue');
  if (b - g > t.blueOverGreenMax) out.push('too blue over green');
  return out;
}

/**
 * Colour verdict for a label: the share of its pixels the gate accepts, and
 * the most common combination of failed rules among the rejected ones.
 */
async function colourVerdict(label: Label, src: TileSource): Promise<{ pass: number; reason: string }> {
  const b = label.bbox;
  const nw = lonLatToTile(b.west, b.north, Z), se = lonLatToTile(b.east, b.south, Z);
  let inside = 0, pass = 0;
  const combos = new Map<string, number>();
  for (let ty = nw.y; ty <= se.y; ty++) {
    for (let tx = nw.x; tx <= se.x; tx++) {
      const tile = { z: Z, x: tx, y: ty };
      const img = await src.get(tile);
      if (!img) continue;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const p = tilePixelToLonLat(tile, x + 0.5, y + 0.5);
          if (p.lon < b.west || p.lon > b.east || p.lat < b.south || p.lat > b.north) continue;
          const isIn = label.point ? distanceM(p, label.point) <= 2.5 : pointInPolygons(p, label.polygons);
          if (!isIn) continue;
          inside++;
          const o = (y * img.width + x) * 4;
          const f = failedRules(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]);
          if (!f.length) pass++;
          else combos.set(f.join(' + '), (combos.get(f.join(' + ')) ?? 0) + 1);
        }
      }
    }
  }
  const top = [...combos].sort((a, b) => b[1] - a[1])[0];
  return { pass: inside ? pass / inside : 0, reason: top ? top[0] : 'no pixels' };
}

export async function diagnoseMisses(zone: Zone, missed: Label[], src: TileSource, threshold: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!missed.length) return out;
  const scan = expandBBoxMeters(zone.bbox, SCAN_MARGIN_M);
  const ring: Ring = [[scan.west, scan.south], [scan.east, scan.south], [scan.east, scan.north], [scan.west, scan.north]];
  const plan = buildScanPlan(ring, Z);
  const run = async (det: object, merge: object) =>
    (await coreDetector('x', '', det, merge).run(plan.tiles, (t) => src.get(t.tile))).detections;
  const noTexture = await run({ maxTexture: 10 }, {});
  const noShape = await run({ maxTexture: 10, minPixels: 1, minAreaM2: 0.5, maxAreaM2: 1e6, maxAspect: 1e3 }, { minAreaM2: 0.5, maxAreaM2: 1e6 });
  const hitBy = (l: Label, ds: EvalDetection[], conf: number) => ds.some((d) => d.confidence >= conf && hits(d, l).ok);

  for (const l of missed) {
    const colour = await colourVerdict(l, src);
    if (colour.pass < 0.3) {
      out.set(l.id, `colour gate: ${colourFamily(colour.reason)} [${colour.reason}]`);
      continue;
    }
    if (hitBy(l, noTexture, 0)) {
      out.set(l.id, hitBy(l, noTexture, threshold) ? 'texture ceiling' : 'texture ceiling (and low confidence)');
    } else if (hitBy(l, noShape, 0)) {
      out.set(l.id, 'size/shape filter or merger');
    } else {
      out.set(l.id, 'mask cleanup (pixels pass, shape lost)');
    }
  }
  return out;
}

/** Group a failed-rule combination into a readable family. */
export function colourFamily(combo: string): string {
  const has = (r: string) => combo.split(' + ').includes(r);
  if (has('hue too blue')) return 'deep blue water (hue above the band)';
  if (has('hue too green') && (has('too dark') || has('too pale'))) return 'dull green or grey water';
  if (has('green over blue') || has('hue too green')) return 'turquoise-green water (green above blue)';
  if (has('too dark')) return 'dark water';
  if (has('too pale')) return 'pale water (low saturation)';
  if (has('not blue over red')) return 'warm-tinted water';
  return combo;
}
