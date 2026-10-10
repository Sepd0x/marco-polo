import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldXToLon, worldYToLat } from '@marco-polo/core';
import { agreement, dedupeBoxes, secondPassWindows, seenInWindows, shareInWindows, zoneWindows, type GeoBox } from '../src/blind.js';
import { blockKey, bootstrapCI, drawBlocks, emptyBlock, METRICS, pairedCI, percentile, rng, type BlockCounts } from '../src/bootstrap.js';
import { comparePaired } from '../src/compare.js';
import type { ZoneResult } from '../src/evaluate.js';
import { checkFrozen, labelsHash, readFreeze, relabel, writeFreeze, fileSha256 } from '../src/freeze.js';
import { computeTargets, logTestRun, readTestRuns, runGate, type ReportFile } from '../src/gate.js';
import { featureToLabel } from '../src/labels.js';
import { cellKey, drawOrder, eligibleCells, eligibleMunicipalities, featureShare, gridCells, hashIndex, isHardCapture, municipalityKey, noonElevationDeg } from '../src/lottery.js';
import { matchDetections, pointAreaCap, V1_MATCH, DEFAULT_MATCH } from '../src/match.js';
import { minAreaRect } from '../src/obb.js';
import { checkRegistry, haversineKm, type Registry, type ZoneDef } from '../src/registry.js';
import { loadPrereg, minKmRule } from '../src/drawzones.js';
import { tileBounds3857, wmsUrl } from '../src/sources.js';
import type { EvalDetection } from '../src/types.js';
import type { RunMeta } from '../src/report.js';

const LON = -8.1;
const LAT = 37.07;

function det(id: string, lon: number, lat: number, wM: number, hM: number, areaM2 = wM * hM): EvalDetection {
  const dLon = wM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  const dLat = hM / 2 / 110540;
  const bbox = { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat };
  return {
    id,
    center: { lon, lat },
    bbox,
    outline: [[[[bbox.west, bbox.south], [bbox.east, bbox.south], [bbox.east, bbox.north], [bbox.west, bbox.north]]]],
    areaM2,
    confidence: 0.9,
  };
}

const point = (id: string, lon: number, lat: number) =>
  featureToLabel({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, source: 'osm', role: 'pool', radius_m: 5 } });

describe('point labels (plan A4)', () => {
  it('a 600 m² detection centred on a point does not hit it', () => {
    const p = point('n/1', LON, LAT);
    const big = det('big', LON, LAT, 30, 20);
    expect(matchDetections([big], [p], DEFAULT_MATCH).pairs).toHaveLength(0);
    // The phase 0 rule accepted it.
    expect(matchDetections([big], [p], V1_MATCH).pairs).toHaveLength(1);
  });

  it('a pool-sized detection within 3 m hits, one 5 m away and small does not', () => {
    const p = point('n/1', LON, LAT);
    const near = det('near', LON + 2 / (111320 * Math.cos((LAT * Math.PI) / 180)), LAT, 4, 3);
    const far = det('far', LON, LAT + 5 / 110540, 4, 3);
    expect(matchDetections([near], [p]).pairs).toHaveLength(1);
    expect(matchDetections([far], [p]).pairs).toHaveLength(0);
  });

  it('the area cap is 4 x the median polygon label, never below 150 m²', () => {
    const sq = (id: string, m: number) => {
      const d = m / 110540;
      const ring = [[LON, LAT], [LON + d, LAT], [LON + d, LAT + d], [LON, LAT + d], [LON, LAT]];
      return featureToLabel({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: { id, source: 'osm', role: 'pool' } });
    };
    expect(pointAreaCap([])).toBe(150);
    expect(pointAreaCap([sq('a', 5), sq('b', 6), sq('c', 7)])).toBe(150);
    const cap = pointAreaCap([sq('a', 8), sq('b', 9), sq('c', 10)]);
    expect(cap).toBeGreaterThan(4 * 60);
    expect(cap).toBeLessThan(4 * 70);
  });
});

describe('block bootstrap (plan A5)', () => {
  it('the same seed reproduces the interval, another seed moves it a little', () => {
    const zone: BlockCounts[] = Array.from({ length: 40 }, (_, i) => ({ ...emptyBlock(`b${i}`), labels: 5, tpLabels: i % 5, dets: 5, tpDets: i % 5, fp: 5 - (i % 5), fn: 5 - (i % 5) }));
    const a = bootstrapCI([zone], METRICS.recall, drawBlocks([40], 2000, 1));
    const b = bootstrapCI([zone], METRICS.recall, drawBlocks([40], 2000, 1));
    const c = bootstrapCI([zone], METRICS.recall, drawBlocks([40], 2000, 2));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect(Math.abs((c.lo ?? 0) - (a.lo ?? 0))).toBeLessThan(0.03);
  });

  it('matches the textbook interval of a proportion', () => {
    // 400 blocks, each one label, 60% hit: bootstrap SE of a proportion is sqrt(p(1-p)/n).
    const zone: BlockCounts[] = Array.from({ length: 400 }, (_, i) => ({ ...emptyBlock(`b${i}`), labels: 1, tpLabels: i % 5 < 3 ? 1 : 0 }));
    const ci = bootstrapCI([zone], METRICS.recall);
    const se = Math.sqrt((0.6 * 0.4) / 400);
    expect(ci.lo!).toBeCloseTo(0.6 - 1.96 * se, 1);
    expect(ci.hi!).toBeCloseTo(0.6 + 1.96 * se, 1);
    expect(ci.lo!).toBeLessThan(0.6);
    expect(ci.hi!).toBeGreaterThan(0.6);
  });

  it('a paired difference of identical runs is exactly zero', () => {
    const zone: BlockCounts[] = Array.from({ length: 30 }, (_, i) => ({ ...emptyBlock(`b${i}`), labels: 3, tpLabels: i % 3, dets: 3, tpDets: i % 3, fp: 1, fn: 3 - (i % 3) }));
    expect(pairedCI([zone], [zone], METRICS.f1)).toEqual({ lo: 0, hi: 0 });
  });

  it('percentile interpolates and blocks are 4 x 4 z19 tiles', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    const a = blockKey({ lon: LON, lat: LAT });
    const b = blockKey({ lon: LON + 1e-5, lat: LAT });
    expect(a).toBe(b);
    const r = rng(5);
    expect(r()).toBe(rng(5)());
  });
});

describe('the TEST draw', () => {
  it('is a pure function of the list commit and the stratum', () => {
    const c = 'ddf92d433297d5b206351b9a5aefd73a4cb7000e';
    expect(hashIndex(municipalityKey(c, 'es'), 501)).toBe(hashIndex(municipalityKey(c, 'es'), 501));
    expect(drawOrder(c, 'es', 7)).toEqual(drawOrder(c, 'es', 7));
    expect(new Set(drawOrder(c, 'es', 7)).size).toBe(7);
    expect(hashIndex(cellKey(c, 'es', '30038'), 8)).toBe(hashIndex(cellKey(c, 'es', '30038'), 8));
    expect(hashIndex(municipalityKey(c + 'x', 'es'), 1_000_003)).not.toBe(hashIndex(municipalityKey(c, 'es'), 1_000_003));
  });

  it('reproduces the committed draw: the hashed start of each stratum', () => {
    const draw = JSON.parse(readFileSync(new URL('../zones/draw.json', import.meta.url), 'utf8')) as { listCommit: string; strata: Array<{ stratum: string; eligible: number; start: number }> };
    for (const s of draw.strata) expect(drawOrder(draw.listCommit, s.stratum, s.eligible)[0]).toBe(s.start);
  });

  it('drops municipalities closer than 50 km and excluded regions', () => {
    const cands = [
      { name: 'near', code: '1', country: 'ES' as const, center: [40.0, -3.0] as [number, number], population: 1, region: '30' },
      { name: 'far', code: '2', country: 'ES' as const, center: [41.0, -3.0] as [number, number], population: 1, region: '30' },
      { name: 'excluded', code: '3', country: 'ES' as const, center: [42.0, -3.0] as [number, number], population: 1, region: '28' },
    ];
    const sites = [{ id: 'z', kind: 'DEV' as const, center: [40.2, -3.0] as [number, number] }];
    expect(eligibleMunicipalities('es', cands, sites, 50, { es: ['28'] }).map((c) => c.name)).toEqual(['far']);
  });

  it('cells: grid from the south-west, share of land use, centre inside the boundary', () => {
    const b = { west: 0, south: 0, east: 0.02, north: 0.02 };
    const cells = gridCells(b, 1);
    expect(cells[0].row).toBe(0);
    expect(cells[0].bbox.west).toBe(0);
    expect(cells[1].col).toBe(1);
    const half = [[[0, 0], [0.0045, 0], [0.0045, 0.02], [0, 0.02]]] as [number, number][][];
    expect(featureShare(cells[0].bbox, [half])).toBeGreaterThan(0.45);
    expect(featureShare(cells[0].bbox, [half])).toBeLessThan(0.6);
    const boundary = [[[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02]]] as [number, number][][];
    expect(eligibleCells(cells, [boundary], [half], [], 50, 0.3).length).toBe(2);
  });

  it('rules v2: per-stratum minimum for some kinds of site, 50 km for the rest', () => {
    const rules = loadPrereg(2).rules;
    const near = (kind: 'DEV' | 'seen' | 'TRAIN' | 'TEST') => ({ id: kind, kind, center: [41.0 + 40 / 111.195, -8.0] as [number, number] });
    const c = [{ name: 'm', code: '1', country: 'PT' as const, center: [41.0, -8.0] as [number, number], population: 1, region: '13' }];
    expect(eligibleMunicipalities('pt-north', c, [near('DEV'), near('seen')], minKmRule(rules, 'pt-north'), {})).toHaveLength(1);
    expect(eligibleMunicipalities('pt-north', c, [near('TRAIN')], minKmRule(rules, 'pt-north'), {})).toHaveLength(0);
    expect(eligibleMunicipalities('pt-north', c, [near('TEST')], minKmRule(rules, 'pt-north'), {})).toHaveLength(0);
    expect(eligibleMunicipalities('pt-rest', c, [near('DEV')], minKmRule(rules, 'pt-rest'), {})).toHaveLength(0);
  });

  it('rules v2: same candidate list, kept zones are TEST zones, retired ones left the registry', () => {
    const pre = loadPrereg(2);
    expect(pre.rules.cellSizeKm).toBe(2);
    expect(pre.rules.minPools).toBe(20);
    expect(pre.strata.map((s) => s.id)).toEqual(loadPrereg(1).strata.map((s) => s.id));
    const r = JSON.parse(readFileSync(new URL('../zones/registry.json', import.meta.url), 'utf8')) as Registry;
    for (const k of pre.kept) expect(r.zones.find((z) => z.id === k.zone)?.role).toBe('TEST');
    for (const z of r.retiredTest ?? []) expect(r.zones.some((x) => x.id === z.id)).toBe(false);
    expect(r.minDistanceKmByStratum).toEqual(pre.rules.minDistanceKmByStratum);
  });

  it('hard imagery: winter months or low noon sun', () => {
    expect(isHardCapture(42, '2025-11-05')).toBe(true);
    expect(isHardCapture(42, '2025-06-21')).toBe(false);
    expect(noonElevationDeg(42, '2025-06-21')).toBeCloseTo(71.4, 0);
    expect(isHardCapture(60, '2025-10-01')).toBe(true);
  });
});

describe('zones check (plan A1, A8)', () => {
  const zone = (id: string, role: ZoneDef['role'], lat: number, lon: number): ZoneDef => ({
    id, name: id, role, country: 'PT', productSource: 'dgt', labelSource: 'dgt', areaKm2: 1, why: '', review: 'blind',
    bbox: { west: lon - 0.005, east: lon + 0.005, south: lat - 0.004, north: lat + 0.004 }, stratum: role === 'TEST' ? 'x' : undefined,
  });
  const reg = (zones: ZoneDef[]): Registry => ({ about: '', minDistanceKm: 50, zones, seen: [] });

  it('a TEST zone 49 km from a DEV zone fails, 51 km passes', () => {
    const dLat = (km: number) => km / 111.195;
    expect(haversineKm([40, -8], [40 + dLat(49), -8])).toBeCloseTo(49, 1);
    expect(checkRegistry(reg([zone('dev', 'DEV', 40, -8), zone('t', 'TEST', 40 + dLat(49), -8)]))).toHaveLength(1);
    expect(checkRegistry(reg([zone('dev', 'DEV', 40, -8), zone('t', 'TEST', 40 + dLat(51), -8)]))).toHaveLength(0);
  });

  it('a stratum with a smaller minimum: 40 km from DEV passes, 40 km from TRAIN fails', () => {
    const dLat = 40 / 111.195;
    const t = { ...zone('t', 'TEST', 40 + dLat, -8), stratum: 'pt-north' };
    const r = (other: ZoneDef): Registry => ({ ...reg([other, t]), minDistanceKmByStratum: { 'pt-north': { DEV: 30, seen: 30 } } });
    expect(checkRegistry(r(zone('dev', 'DEV', 40, -8)))).toHaveLength(0);
    expect(checkRegistry(r(zone('train', 'TRAIN', 40, -8)))).toHaveLength(1);
  });

  it('a training zone added near a TEST zone fails', () => {
    expect(checkRegistry(reg([zone('t', 'TEST', 40, -8), zone('train', 'TRAIN', 40.2, -8)]))).toHaveLength(1);
  });

  it('the committed registry passes', () => {
    const r = JSON.parse(readFileSync(new URL('../zones/registry.json', import.meta.url), 'utf8')) as Registry;
    expect(checkRegistry(r)).toEqual([]);
  });
});

describe('frozen labels (plan A3)', () => {
  it('refuses a changed file, and a relabel re-freezes and logs it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'labels-'));
    writeFileSync(join(dir, 'z.geojson'), '{"a":1}\n');
    writeFreeze(dir, new Map([['z.geojson', fileSha256(join(dir, 'z.geojson'))]]));
    expect(checkFrozen(dir, ['z'])).toEqual([]);
    const before = labelsHash(dir, ['z']);
    writeFileSync(join(dir, 'z.geojson'), '{"a":2}\n');
    expect(checkFrozen(dir, ['z'])).toEqual([{ zone: 'z', file: 'z.geojson', problem: 'changed' }]);
    writeFileSync(join(dir, 'z.extra.geojson'), '{}\n');
    expect(checkFrozen(dir, ['z']).map((p) => p.problem).sort()).toEqual(['changed', 'not frozen']);
    expect(() => relabel(dir, ['z'], ' ', 'abc')).toThrow();
    expect(relabel(dir, ['z'], 'fixed a box', 'abc').sort()).toEqual(['z.extra.geojson', 'z.geojson']);
    expect(checkFrozen(dir, ['z'])).toEqual([]);
    expect(labelsHash(dir, ['z'])).not.toBe(before);
    expect(readFileSync(join(dir, 'RELABEL_LOG.md'), 'utf8')).toContain('fixed a box');
    expect(readFreeze(dir).size).toBe(2);
  });

  it('line endings do not change the hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'labels-'));
    writeFileSync(join(dir, 'a.geojson'), '{\n"a":1\n}\n');
    writeFileSync(join(dir, 'b.geojson'), '{\r\n"a":1\r\n}\r\n');
    expect(fileSha256(join(dir, 'a.geojson'))).toBe(fileSha256(join(dir, 'b.geojson')));
  });
});

describe('blind review (plan A3)', () => {
  const box = (w: number, s: number, kind: 'p' | 'u' = 'p'): GeoBox => ({ window: 'w', kind, bbox: { west: w, south: s, east: w + 1e-4, north: s + 1e-4 } });

  it('the second pass takes 20% of the windows, always the same ones', () => {
    const ws = zoneWindows({ bbox: { west: -8.385, south: 41.565, east: -8.373, north: 41.574 } });
    expect(ws.length).toBe(25);
    const a = secondPassWindows('braga', ws);
    expect(a).toHaveLength(5);
    expect(secondPassWindows('braga', ws)).toEqual(a);
    expect(secondPassWindows('other', ws)).not.toEqual(a);
  });

  it('agreement: F1 between passes, unsure boxes are left out', () => {
    const a = [box(0, 0), box(1e-3, 0), box(2e-3, 0)];
    const b = [box(0.1e-4, 0), box(1e-3, 0, 'u'), box(5e-3, 0)];
    const r = agreement(a, b);
    expect(r.matched).toBe(1);
    expect(r.onlyA).toBe(1);
    expect(r.onlyB).toBe(1);
    expect(r.f1).toBeCloseTo(0.5);
  });

  it('a first pass box cut by a second pass window edge still counts as seen there', () => {
    const z = 19;
    const w = { id: 'w-00-00', x0: 1000, y0: 1000, size: 1024 };
    const geo = (px0: number, px1: number) => ({ west: worldXToLon(px0, z), east: worldXToLon(px1, z), north: worldYToLat(1100, z), south: worldYToLat(1140, z) });
    // A pool from x 2010 to 2070: its centre lies past the window's right edge (2024).
    expect(seenInWindows(geo(2010, 2070), [w], 'centre')).toBe(false);
    expect(seenInWindows(geo(2010, 2070), [w], 'touches')).toBe(true);
    expect(seenInWindows(geo(2030, 2070), [w], 'touches')).toBe(false);
    expect(seenInWindows(geo(1500, 1540), [w], 'centre')).toBe(true);
    expect(shareInWindows(geo(2010, 2070), [w])).toBeCloseTo(0.2, 6);
    expect(shareInWindows(geo(1500, 1540), [w])).toBe(1);
  });

  it('agreement: an unmatched first pass box can be left out of the count', () => {
    const a = [box(0, 0), box(1e-3, 0)];
    const b = [box(0.1e-4, 0)];
    expect(agreement(a, b).onlyA).toBe(1);
    const r = agreement(a, b, (x) => x.bbox.west < 5e-4);
    expect(r.onlyA).toBe(0);
    expect(r.f1).toBe(1);
  });

  it('boxes of one pool seen from two windows collapse into one', () => {
    expect(dedupeBoxes([box(0, 0), box(0.2e-4, 0.1e-4), box(1e-3, 0)])).toHaveLength(2);
    expect(dedupeBoxes([box(0, 0, 'u'), box(0.2e-4, 0)])[0].kind).toBe('p');
  });
});

describe('measurement', () => {
  it('minimum-area rectangle of a rotated 10 x 4 m rectangle, error under 1%', () => {
    for (const deg of [0, 17, 45, 73, 120]) {
      const t = (deg * Math.PI) / 180;
      const pts: [number, number][] = [[-5, -2], [5, -2], [5, 2], [-5, 2]].map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
      const r = minAreaRect(pts)!;
      expect(Math.abs(r.lengthM - 10) / 10).toBeLessThan(0.01);
      expect(Math.abs(r.widthM - 4) / 4).toBeLessThan(0.01);
    }
    expect(minAreaRect([[0, 0], [1, 1]])).toBeNull();
  });

  it('WMS box of a known tile', () => {
    // z19 tile 251768/198620: EPSG:3857 bounds from the tile grid.
    const [minx, miny, maxx, maxy] = tileBounds3857({ z: 0, x: 0, y: 0 });
    expect(minx).toBeCloseTo(-20037508.34, 1);
    expect(maxy).toBeCloseTo(20037508.34, 1);
    expect(maxx - minx).toBeCloseTo(40075016.69, 1);
    expect(miny).toBeCloseTo(-20037508.34, 1);
    const u = wmsUrl('https://x/wms?BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512', { z: 1, x: 1, y: 0 }, 256);
    expect(u).toBe('https://x/wms?BBOX=0.000,0.000,20037508.343,20037508.343&WIDTH=256&HEIGHT=256');
  });
});

// Two runs on a few zones, built from block counts, for the gate.
function zoneResult(zone: string, role: ZoneDef['role'], blocks: BlockCounts[], extra: Partial<ZoneResult> = {}): ZoneResult {
  const sum = blocks.reduce((a, b) => ({ ...a, labels: a.labels + b.labels, tpLabels: a.tpLabels + b.tpLabels, dets: a.dets + b.dets, tpDets: a.tpDets + b.tpDets, fp: a.fp + b.fp, fn: a.fn + b.fn }), emptyBlock(''));
  const counts = { labels: sum.labels, tpLabels: sum.tpLabels, dets: sum.dets, tpDets: sum.tpDets, fp: sum.fp, fn: sum.fn, ignored: 0 };
  const p = counts.dets ? counts.tpDets / counts.dets : null;
  const r = counts.labels ? counts.tpLabels / counts.labels : null;
  const pairs = blocks.flatMap((b, i) => Array.from({ length: b.tpLabels }, (_, k) => ({ label: `l${i}-${k}`, det: `d${i}-${k}`, block: b.key, labelM2: 40, detM2: 40 * (1 + (b.areaRel[0] ?? 0)), centerOffsetM: 0.5, labelDims: null, detDims: null })));
  return {
    zone, name: zone, role, stratum: role === 'TEST' ? 'pt-rest' : null, reportedApart: false, review: 'blind', source: 'dgt-ortos2025', areaKm2: 1, tiles: 300, tilesMissing: 0,
    labels: { pool: counts.labels, ignore: 0, points: 0, visual: 0, overrides: 0, absent: 0 }, threshold: 0.5, match: { pointRule: 'v2', pointMaxAreaM2: 150 },
    counts, scores: { precision: p, recall: r, f1: p !== null && r !== null && p + r > 0 ? (2 * p * r) / (p + r) : null },
    area: { medianAbsRel: null, medianSignedRel: null, n: 0 }, areaRel: blocks.flatMap((b) => b.areaRel), blocks, pairs, unmatched: [], computeMs: 1, msPerKm2: 1, detectionsAll: counts.dets, sweep: [], items: [],
    ...extra,
  };
}

function blocksOf(n: number, tp: number, fp: number, areaRel: number): BlockCounts[] {
  return Array.from({ length: n }, (_, i) => ({ ...emptyBlock(`b${i}`), labels: 4, tpLabels: tp, dets: tp + fp, tpDets: tp, fp, fn: 4 - tp, areaRel: Array.from({ length: tp }, () => areaRel) }));
}

const meta = (detector: string, hash: string): RunMeta => ({
  name: detector, detector, detectorDescription: '', detectorHash: hash, source: 'auto', threshold: 0.5, matchRule: 'v2', labelsHash: 'L', tilesHash: 'T', tilesRead: 1,
  bootstrap: { replicates: 2000, seed: 20261007, blockTiles: 4, zoom: 19 }, date: '2026-10-08', commit: 'c',
});

function reports(v2tp: number, v2fp: number) {
  const v1: ReportFile = {
    meta: meta('v1', 'H'),
    zones: [
      zoneResult('dev', 'DEV', blocksOf(30, 2, 2, -0.2)),
      zoneResult('odemira', 'DEV', blocksOf(5, 0, 0, 0).map((b) => ({ ...b, labels: 0, fn: 0 }))),
      zoneResult('t1', 'TEST', blocksOf(30, 2, 2, -0.2)),
      zoneResult('neg', 'TEST', blocksOf(10, 0, 1, 0).map((b) => ({ ...b, labels: 0, fn: 0 })), { stratum: 'negative', reportedApart: true }),
      zoneResult('gold', 'GOLD', blocksOf(10, 3, 0, 0)),
    ],
  };
  const v2: ReportFile = {
    meta: meta('v2', 'H'),
    goldMosaicRecall: { gold: 0.76 },
    zones: [
      zoneResult('dev', 'DEV', blocksOf(30, v2tp, v2fp, -0.02)),
      zoneResult('odemira', 'DEV', blocksOf(5, 0, 0, 0).map((b) => ({ ...b, labels: 0, fn: 0 }))),
      zoneResult('t1', 'TEST', blocksOf(30, v2tp, v2fp, -0.02)),
      zoneResult('neg', 'TEST', blocksOf(10, 0, 0, 0).map((b) => ({ ...b, labels: 0, fn: 0 })), { stratum: 'negative', reportedApart: true }),
      zoneResult('gold', 'GOLD', blocksOf(10, 3, 0, 0)),
    ],
  };
  return { v1, v2 };
}

describe('gate (plan 3.4)', () => {
  const targetsFor = (v1: ReportFile, v2: ReportFile) => computeTargets(comparePaired(v1.zones, v2.zones, ['dev']), 'c', '2026-10-08');
  const gate = (v1: ReportFile, v2: ReportFile, over: Partial<Parameters<typeof runGate>[0]> = {}) =>
    runGate({ v1, v2, currentDetectorHash: 'H', currentLabelsHash: () => 'L', targets: targetsFor(v1, v2), targetsSha: 'S', testRuns: [], ...over });

  it('passes a clearly better v2', () => {
    const { v1, v2 } = reports(4, 0);
    const failed = gate(v1, v2).filter((c) => !c.ok);
    expect(failed).toEqual([]);
  });

  it('v1 against itself fails the floors', () => {
    const { v1 } = reports(4, 0);
    const failed = gate(v1, { ...v1, meta: meta('v1', 'H'), goldMosaicRecall: { gold: 0.75 } }).filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toContain('P1');
    expect(failed).toContain('P2');
  });

  it('fails a target: a v2 that is better, but not by 10 points', () => {
    const { v1, v2 } = reports(2, 1);
    expect(gate(v1, v2).find((c) => c.id === 'P1')!.ok).toBe(false);
  });

  it('fails a stale report (detector changed since the run)', () => {
    const { v1, v2 } = reports(4, 0);
    expect(gate(v1, v2, { currentDetectorHash: 'other' }).find((c) => c.id === 'fresh')!.ok).toBe(false);
  });

  it('fails when targets.json changed after a TEST run was logged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    const targets = join(dir, 'targets.json');
    const runs = join(dir, 'TEST_RUNS.md');
    expect(() => logTestRun(runs, targets, { date: 'd', commit: 'c', detector: 'v2', detectorHash: 'H', why: 'first' })).toThrow(/targets/);
    writeFileSync(targets, '{"targets":{}}');
    logTestRun(runs, targets, { date: 'd', commit: 'c', detector: 'v2', detectorHash: 'H', why: 'first' });
    const logged = readTestRuns(runs);
    expect(logged).toHaveLength(1);
    const { v1, v2 } = reports(4, 0);
    expect(gate(v1, v2, { testRuns: logged, targetsSha: logged[0].targetsSha }).find((c) => c.id === 'targets unchanged')!.ok).toBe(true);
    expect(gate(v1, v2, { testRuns: logged, targetsSha: 'changed' }).find((c) => c.id === 'targets unchanged')!.ok).toBe(false);
  });

  it('allows three TEST runs and refuses the fourth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    const targets = join(dir, 'targets.json');
    const runs = join(dir, 'TEST_RUNS.md');
    writeFileSync(targets, '{}');
    for (let i = 0; i < 3; i++) logTestRun(runs, targets, { date: 'd', commit: 'c', detector: 'v2', detectorHash: 'H', why: `run ${i}` });
    expect(() => logTestRun(runs, targets, { date: 'd', commit: 'c', detector: 'v2', detectorHash: 'H', why: 'again' })).toThrow(/3 times/);
  });

  it('reports a missing measurement as a failure, never as a pass', () => {
    const { v1, v2 } = reports(4, 0);
    const noGold = { ...v2, goldMosaicRecall: undefined };
    expect(gate(v1, noGold).find((c) => c.id === 'P8')!.ok).toBe(false);
  });
});
