/**
 * Runs the pre-registered TEST draw. Rules v1: zones/test-candidates.json,
 * attempts in zones/draw.json (closed). Rules v2: zones/test-candidates-v2.json
 * (same strata and candidates, new cell size, pool minimum and distances),
 * attempts in zones/draw-v2.json. Reads administrative boundaries, OSM land
 * use and Esri capture metadata; never imagery. Every attempt is written,
 * including the ones that were skipped and why.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BBox } from '@marco-polo/core';
import { sleep } from '../../cli/src/tiles.js';
import type { Candidate, SourceId, Stratum } from './candidates.js';
import { polygonsBBox, type Polygon } from './geom.js';
import { cellKey, drawOrder, eligibleCells, eligibleMunicipalities, gridCells, hashIndex, isHardCapture, noonElevationDeg, type MinKm } from './lottery.js';
import { elementPolygons, overpass, UA } from './overpass.js';
import { loadRegistry, protectedSites, ZONES_DIR, zoneCenter, type ProtectedSite, type Registry, type Role, type ZoneDef } from './registry.js';

export interface Rules {
  minDistanceKm: number;
  cellSizeKm: number;
  cellMinShare: number;
  minPools: number;
  minDistanceKmByStratum?: Record<string, Partial<Record<Role | 'seen', number>>>;
}

export interface CandidatesFile {
  rules: Rules;
  excludedRegions: Record<string, string[]>;
  strata: Stratum[];
}

/** A TEST zone drawn under rules v1 that rules v2 keep as the zone of its stratum. */
export interface KeptZone {
  zone: string;
  stratum: string;
  why: string;
}

/** A TEST zone drawn under rules v1 and dropped by rules v2 before anyone reviewed it. */
export interface RetiredZone {
  zone: string;
  stratum: string;
  why: string;
}

export interface CandidatesV2File {
  about: string;
  rules: Rules;
  /** The v1 list of strata and municipalities, reused unchanged. */
  candidates: { file: string; sha256: string };
  kept: KeptZone[];
  retired: RetiredZone[];
  /** Places outside this branch's registry that a TEST zone must also keep away from. */
  alsoProtected: Array<{ id: string; kind: Role | 'seen'; center: [number, number]; from: string }>;
}

export type RulesVersion = 1 | 2;

/** One pre-registration, resolved: what the draw needs from the committed files. */
export interface Prereg {
  version: RulesVersion;
  /** File that was committed before any imagery; its adding commit seeds the hashes. */
  file: string;
  drawFile: string;
  rules: Rules;
  excludedRegions: Record<string, string[]>;
  strata: Stratum[];
  kept: KeptZone[];
  alsoProtected: ProtectedSite[];
}

export type AttemptStatus = 'drawn' | 'no eligible cell' | 'not hard imagery' | 'same Esri capture as a DEV zone' | 'no boundary' | `rejected: ${number} pools after review`;

export interface Attempt {
  /** Position in the eligible list; -1 for a zone kept from an earlier draw. */
  index: number;
  municipality: { name: string; code: string };
  status: AttemptStatus;
  eligibleCells?: number;
  cell?: { row: number; col: number; share: number; bbox: BBox };
  esri?: { date: string | null; desc: string | null; resM: number | null; noonElevationDeg: number | null };
  osmSha256?: string;
  keptFrom?: string;
}

export interface StratumDraw {
  stratum: string;
  eligible: number;
  start: number;
  attempts: Attempt[];
  zone?: string;
  /** Zones of this stratum rejected after review; they stay in the registry as seen places. */
  rejected?: string[];
  /** Every eligible municipality was tried and none kept: the stratum has no TEST zone. */
  exhausted?: boolean;
}

export interface DrawFile {
  about: string;
  rules?: RulesVersion;
  listCommit: string;
  candidatesSha256: string;
  registrySha256AtStart: string;
  strata: StratumDraw[];
  /** Hand corrections of attempts that a server failure made wrong, each made before any imagery of the zones involved was opened. */
  corrections?: Array<{ date: string; stratum: string; removed: string[]; why: string }>;
}

export const DRAW_FILE = join(ZONES_DIR, 'draw.json');
export const DRAW_V2_FILE = join(ZONES_DIR, 'draw-v2.json');
const CANDIDATES = 'test-candidates.json';
const CANDIDATES_V2 = 'test-candidates-v2.json';

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (res.ok) return (await res.json()) as T;
    } catch {
      // retry
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`failed: ${url}`);
}

const OSM_CODE_TAG: Record<string, string> = { PT: 'ref:ine', ES: 'ine:municipio', IT: 'ref:ISTAT' };

/** Municipality boundary as polygons (outer ring plus holes). */
async function boundary(c: Candidate): Promise<Polygon[]> {
  if (c.country === 'FR') {
    const g = await getJson<{ geometry?: { type: string; coordinates: number[][][] | number[][][][] } }>(
      `https://geo.api.gouv.fr/communes/${c.code}?format=geojson&geometry=contour`,
    );
    return geojsonPolygons(g.geometry);
  }
  if (c.country === 'US') {
    const url =
      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/25/query?' +
      new URLSearchParams({ where: `GEOID='${c.code}'`, outFields: 'GEOID', returnGeometry: 'true', outSR: '4326', f: 'geojson' });
    const g = await getJson<{ features: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }> }>(url);
    return g.features.flatMap((f) => geojsonPolygons(f.geometry));
  }
  const tag = OSM_CODE_TAG[c.country];
  const els = await overpass(
    `[out:json][timeout:180];area["ISO3166-1"="${c.country}"][admin_level=2]->.a;rel(area.a)[boundary=administrative]["${tag}"="${c.code}"];out geom;`,
  );
  return els.flatMap((e) => elementPolygons(e));
}

function geojsonPolygons(g: { type: string; coordinates: number[][][] | number[][][][] } | undefined): Polygon[] {
  if (!g) return [];
  const toPoly = (p: number[][][]): Polygon => p.map((r) => r.map(([x, y]) => [x, y] as [number, number]));
  if (g.type === 'Polygon') return [toPoly(g.coordinates as number[][][])];
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).map(toPoly);
  return [];
}

const FEATURE_QUERY: Record<string, string> = {
  'landuse=residential': 'way["landuse"="residential"]({b});relation["landuse"="residential"]({b});',
  'landuse=port, landuse=industrial or leisure=marina':
    'way["landuse"~"^(port|industrial)$"]({b});relation["landuse"~"^(port|industrial)$"]({b});way["leisure"="marina"]({b});relation["leisure"="marina"]({b});',
};

async function features(kind: string, b: BBox, rawDir: string, name: string): Promise<{ polys: Polygon[]; sha: string }> {
  const q = FEATURE_QUERY[kind];
  if (!q) throw new Error(`no query for features "${kind}"`);
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  const els = await overpass(`[out:json][timeout:300];(${q.replaceAll('{b}', bb)});out geom;`);
  const raw = JSON.stringify(els);
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, `${name}.json`), raw, 'utf8');
  return { polys: els.flatMap((e) => elementPolygons(e)), sha: createHash('sha256').update(raw).digest('hex') };
}

export interface EsriCapture {
  date: string | null;
  desc: string | null;
  resM: number | null;
}

/** Esri World Imagery capture at a point: layer 9 ("30cm Resolution Metadata", the z19 level). */
export async function esriCapture(lat: number, lon: number): Promise<EsriCapture> {
  const url =
    'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/9/query?' +
    new URLSearchParams({
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'SRC_DATE2,SRC_DESC,SRC_RES',
      returnGeometry: 'false',
      f: 'json',
    });
  const j = await getJson<{ features?: Array<{ attributes: { SRC_DATE2?: number; SRC_DESC?: string; SRC_RES?: number } }> }>(url);
  const a = j.features?.[0]?.attributes;
  if (!a) return { date: null, desc: null, resM: null };
  return { date: a.SRC_DATE2 ? new Date(a.SRC_DATE2).toISOString().slice(0, 10) : null, desc: a.SRC_DESC ?? null, resM: a.SRC_RES ?? null };
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

const NEGATIVE_SOURCE: Record<string, SourceId> = { PT: 'dgt', ES: 'pnoa', FR: 'ign' };

const rel = (file: string) => `packages/eval/zones/${file}`;
const lf = (b: Buffer | string) => b.toString().replace(/\r\n/g, '\n');
const sha256File = (p: string) => createHash('sha256').update(lf(readFileSync(p))).digest('hex');

/** The commit that added a pre-registration file: the seed of every hash of its draw. */
export function listCommit(repoRoot: string, file = CANDIDATES): string {
  const out = execSync(`git log --diff-filter=A --format=%H -- ${rel(file)}`, { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n');
  const first = out[out.length - 1];
  if (!/^[0-9a-f]{40}$/.test(first)) throw new Error(`${file} is not committed: commit it before drawing`);
  return first;
}

/** The pre-registration file as committed must be the file on disk. */
function assertUnchanged(repoRoot: string, file: string): string {
  const commit = listCommit(repoRoot, file);
  const committed = execSync(`git show ${commit}:${rel(file)}`, { cwd: repoRoot, encoding: 'buffer', maxBuffer: 1 << 26 });
  if (createHash('sha256').update(lf(committed)).digest('hex') !== sha256File(join(ZONES_DIR, file))) {
    throw new Error(`${file} differs from the pre-registered version`);
  }
  return commit;
}

export function loadPrereg(version: RulesVersion): Prereg {
  const v1 = JSON.parse(readFileSync(join(ZONES_DIR, CANDIDATES), 'utf8')) as CandidatesFile;
  if (version === 1) {
    return { version, file: CANDIDATES, drawFile: DRAW_FILE, rules: v1.rules, excludedRegions: v1.excludedRegions, strata: v1.strata, kept: [], alsoProtected: [] };
  }
  const v2 = JSON.parse(readFileSync(join(ZONES_DIR, CANDIDATES_V2), 'utf8')) as CandidatesV2File;
  if (v2.candidates.file !== CANDIDATES || sha256File(join(ZONES_DIR, CANDIDATES)) !== v2.candidates.sha256) {
    throw new Error(`${CANDIDATES_V2} names a candidate list other than the committed ${CANDIDATES}`);
  }
  return {
    version,
    file: CANDIDATES_V2,
    drawFile: DRAW_V2_FILE,
    rules: v2.rules,
    excludedRegions: v1.excludedRegions,
    strata: v1.strata,
    kept: v2.kept,
    alsoProtected: v2.alsoProtected.map(({ id, kind, center }) => ({ id, kind, center })),
  };
}

/** Minimum distance from a site, for a TEST zone of `stratum`. */
export function minKmRule(rules: Rules, stratum: string): MinKm {
  const own = rules.minDistanceKmByStratum?.[stratum];
  if (!own) return rules.minDistanceKm;
  return (s: ProtectedSite) => own[s.kind] ?? rules.minDistanceKm;
}

export function readDraw(path = DRAW_FILE): DrawFile | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as DrawFile) : null;
}

/**
 * Draw (or continue) one stratum. A stratum whose last attempt is "drawn"
 * is left alone; one whose last attempt was rejected after review goes on
 * with the next municipality in the hashed order. Under rules v2 a stratum
 * with a zone kept from the v1 draw starts, and ends, with that zone.
 */
export async function drawStratum(repoRoot: string, stratumId: string, rawDir: string, version: RulesVersion = 2): Promise<StratumDraw> {
  const pre = loadPrereg(version);
  const commit = assertUnchanged(repoRoot, pre.file);
  if (version > 1) assertUnchanged(repoRoot, CANDIDATES);
  const idx = pre.strata.findIndex((s) => s.id === stratumId);
  if (idx < 0) throw new Error(`unknown stratum ${stratumId}`);
  const stratum = pre.strata[idx];
  const draw: DrawFile = readDraw(pre.drawFile) ?? {
    about: `TEST draw, one entry per stratum with every attempt. Rules: zones/${pre.file}. Raw OSM answers are kept outside the repo; their sha256 is here.`,
    ...(version > 1 ? { rules: version } : {}),
    listCommit: commit,
    candidatesSha256: sha256File(join(ZONES_DIR, pre.file)),
    registrySha256AtStart: sha256File(join(ZONES_DIR, 'registry.json')),
    strata: [],
  };
  if (draw.listCommit !== commit) throw new Error(`${base(pre.drawFile)} was made with list commit ${draw.listCommit}, the list was added in ${commit}`);
  for (const earlier of pre.strata.slice(0, idx)) {
    if (!draw.strata.some((s) => s.stratum === earlier.id && (s.zone || s.exhausted))) throw new Error(`draw strata in file order: ${earlier.id} first`);
  }
  let sd = draw.strata.find((s) => s.stratum === stratumId);
  const last = sd?.attempts[sd.attempts.length - 1];
  if (sd && last?.status === 'drawn') return sd;

  const reg = loadRegistry();
  const save = () => writeFileSync(pre.drawFile, JSON.stringify(draw, null, 1) + '\n', 'utf8');
  const kept = new Set(pre.kept.map((k) => k.zone));
  // A stratum's own zones never move its eligible list: the hashed order stays fixed.
  const own = new Set([...(sd?.rejected ?? []), ...reg.zones.filter((z) => z.role === 'TEST' && z.stratum === stratumId).map((z) => z.id)]);
  // TEST zones count when drawn before this stratum; kept zones were all drawn before any v2 attempt.
  const later = new Set(pre.strata.slice(idx + 1).map((s) => s.id));
  const laterZones = new Set([
    ...reg.zones.filter((z) => z.role === 'TEST' && z.stratum && later.has(z.stratum) && !kept.has(z.id)).map((z) => z.id),
    ...draw.strata.filter((s) => later.has(s.stratum)).flatMap((s) => s.rejected ?? []),
  ]);
  const sites = [...protectedSites(reg).filter((s) => !own.has(s.id) && !laterZones.has(s.id)), ...pre.alsoProtected];
  const minKm = minKmRule(pre.rules, stratumId);
  const elig = eligibleMunicipalities(stratumId, stratum.candidates, sites, minKm, pre.excludedRegions);
  if (!elig.length) throw new Error(`${stratumId}: no eligible municipality`);
  const order = drawOrder(commit, stratumId, elig.length);
  if (!sd) {
    sd = { stratum: stratumId, eligible: elig.length, start: order[0], attempts: [] };
    draw.strata.push(sd);
    const k = pre.kept.find((x) => x.stratum === stratumId);
    if (k) {
      const z = reg.zones.find((x) => x.id === k.zone && x.role === 'TEST');
      if (!z) throw new Error(`kept zone ${k.zone} is not a TEST zone of the registry`);
      const from = readDraw(DRAW_FILE)?.strata.find((s) => s.zone === z.id)?.attempts.at(-1);
      sd.attempts.push({ ...(from ?? { municipality: { name: z.name, code: '' } }), index: -1, status: 'drawn', keptFrom: `draw.json (rules v1): ${k.why}` });
      sd.zone = z.id;
      save();
      return sd;
    }
  }
  if (sd.eligible !== elig.length) throw new Error(`${stratumId}: ${elig.length} eligible now, ${sd.eligible} when the draw started (registry changed?)`);
  const devEsri = reg.zones.filter((z) => (z.role === 'DEV' || z.role === 'DEV-2') && z.productSource === 'esri');
  const esriStratum = stratum.source === 'esri';
  const devCaptures = esriStratum ? await Promise.all(devEsri.map((z) => esriCapture(...zoneCenter(z)))) : [];
  const taken = new Set([...reg.zones.map((z) => z.id), ...(reg.rejectedTest ?? []).map((z) => z.id), ...(reg.retiredTest ?? []).map((z) => z.id)]);

  for (let k = sd.attempts.filter((a) => a.index >= 0).length; k < order.length; k++) {
    const c = elig[order[k]];
    const at: Attempt = { index: order[k], municipality: { name: c.name, code: c.code }, status: 'drawn' };
    console.log(`${stratumId}: try ${k + 1}, ${c.name} (${c.code})`);
    const poly = await boundary(c);
    if (!poly.length) {
      // Every candidate had a boundary when the list was built, so an empty answer is a
      // server failure (seen on public Overpass mirrors), not a reason to skip the municipality.
      if (version > 1) throw new Error(`${c.name}: empty boundary answer; draw again later`);
      at.status = 'no boundary';
      sd.attempts.push(at);
      continue;
    }
    const bounds = polygonsBBox(poly);
    const { polys, sha } = await features(stratum.cellFeatures, bounds, rawDir, `${stratumId}-${c.code}`);
    at.osmSha256 = sha;
    const cells = eligibleCells(gridCells(bounds, pre.rules.cellSizeKm), poly, polys, sites, minKm, pre.rules.cellMinShare);
    at.eligibleCells = cells.length;
    if (!cells.length) {
      at.status = 'no eligible cell';
      sd.attempts.push(at);
      continue;
    }
    const cell = cells[hashIndex(cellKey(commit, stratumId, c.code), cells.length)];
    at.cell = { row: cell.row, col: cell.col, share: Math.round(cell.share * 1000) / 1000, bbox: cell.bbox };
    if (esriStratum) {
      const cap = await esriCapture(cell.center.lat, cell.center.lon);
      at.esri = { ...cap, noonElevationDeg: cap.date ? Math.round(noonElevationDeg(cell.center.lat, cap.date) * 10) / 10 : null };
      if (devCaptures.some((d) => d.date === cap.date && d.desc === cap.desc)) at.status = 'same Esri capture as a DEV zone';
      else if (stratumId === 'hard' && (!cap.date || !isHardCapture(cell.center.lat, cap.date))) at.status = 'not hard imagery';
    }
    sd.attempts.push(at);
    save();
    if (at.status !== 'drawn') continue;

    const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
    let id = `test-${stratumId}-${slug(c.name)}`;
    // A municipality drawn under rules v1 can come back with a v2 cell: new id, new review.
    if (taken.has(id)) id += `-v${version}`;
    const zone: ZoneDef = {
      id,
      name: `${c.name}, ${c.country} (TEST ${stratumId})`,
      role: 'TEST',
      country: c.country,
      productSource: stratum.source === 'auto' ? NEGATIVE_SOURCE[c.country] : stratum.source,
      labelSource: stratum.source === 'auto' ? NEGATIVE_SOURCE[c.country] : stratum.source,
      bbox: { west: r6(cell.bbox.west), south: r6(cell.bbox.south), east: r6(cell.bbox.east), north: r6(cell.bbox.north) },
      areaKm2: pre.rules.cellSizeKm ** 2,
      why: `drawn for stratum ${stratumId}${version > 1 ? ` under rules v${version}` : ''}: ${c.name} (${c.code}), cell ${cell.row}/${cell.col}`,
      review: 'blind',
      stratum: stratumId,
      reportedApart: stratum.reportedApart,
    };
    addZone(reg, zone);
    sd.zone = zone.id;
    save();
    return sd;
  }
  sd.exhausted = true;
  save();
  throw new Error(`${stratumId}: every eligible municipality tried`);
}

function saveRegistry(reg: Registry) {
  writeFileSync(join(ZONES_DIR, 'registry.json'), JSON.stringify(reg, null, 1) + '\n', 'utf8');
}

function addZone(reg: Registry, zone: ZoneDef) {
  if (reg.zones.some((z) => z.id === zone.id)) throw new Error(`zone ${zone.id} already in the registry`);
  saveRegistry({ ...reg, zones: [...reg.zones, zone] });
}

/** After review: the zone had too few pools, so the stratum moves to the next municipality. */
export function rejectAfterReview(stratumId: string, pools: number, version: RulesVersion = 2): void {
  const pre = loadPrereg(version);
  const draw = readDraw(pre.drawFile);
  const sd = draw?.strata.find((s) => s.stratum === stratumId);
  const last = sd?.attempts[sd.attempts.length - 1];
  if (!draw || !sd || !last || last.status !== 'drawn') throw new Error(`${stratumId}: nothing drawn to reject`);
  if (stratumId === 'negative') throw new Error('the pool minimum does not apply to the negative stratum');
  if (last.keptFrom) throw new Error(`${stratumId}: ${sd.zone} was kept by the rules, not drawn under them`);
  if (pools >= pre.rules.minPools) throw new Error(`${stratumId}: ${pools} pools is not below ${pre.rules.minPools}`);
  last.status = `rejected: ${pools} pools after review`;
  // It leaves the TEST role and is kept on record. It does not block other zones: it was
  // reviewed blind and never scanned or tuned on, so nearby TEST zones learn nothing from it.
  const reg = loadRegistry();
  const z = reg.zones.find((x) => x.id === sd.zone);
  if (z) {
    saveRegistry({
      ...reg,
      zones: reg.zones.filter((x) => x.id !== z.id),
      rejectedTest: [...(reg.rejectedTest ?? []), { id: z.id, stratum: stratumId, bbox: z.bbox, pools }],
    });
    sd.rejected = [...(sd.rejected ?? []), z.id];
  }
  sd.zone = undefined;
  writeFileSync(pre.drawFile, JSON.stringify(draw, null, 1) + '\n', 'utf8');
}

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Markdown summary of the draw: where each stratum stands. */
export function drawStatus(version: RulesVersion = 2): string {
  const pre = loadPrereg(version);
  const draw = readDraw(pre.drawFile);
  if (!draw) return 'No draw yet.';
  const v1 = version > 1 ? readDraw(DRAW_FILE) : null;
  const L = [
    '# TEST zones',
    '',
    `Drawn from the list committed in \`${draw.listCommit.slice(0, 7)}\` by the rules written in it (\`zones/${pre.file}\`). Generated by \`eval zones status\` from \`zones/${base(pre.drawFile)}\`.`,
  ];
  if (v1) {
    L.push(
      '',
      `Rules v2 replace the v1 draw (list \`${v1.listCommit.slice(0, 7)}\`, \`zones/draw.json\`, kept as it was): its 1 km cells with 40 pools or more ran out in the north of Portugal and rejected most of what was drawn. v2: cells of ${pre.rules.cellSizeKm} km, at least ${pre.rules.minPools} pools, the per-stratum distances written in the file. A zone kept from v1 is the only attempt of its stratum.`,
    );
  }
  L.push('', `| stratum | eligible | tried | rejected after review (under ${pre.rules.minPools} pools) | other skips | zone | labels |`, '|---|--:|--:|--:|--:|---|---|');
  const labelState = (zone: string | undefined) => {
    if (!zone) return '';
    const path = join(ZONES_DIR, '..', 'labels', `${zone}.geojson`);
    if (!existsSync(path)) return 'not reviewed yet';
    const f = JSON.parse(readFileSync(path, 'utf8')) as { poolsInZone?: number };
    const agree = join(ZONES_DIR, '..', 'labels', 'review', zone, 'agreement.json');
    return `blind pass 1 and OSM check, ${f.poolsInZone ?? '?'} pools; second pass ${existsSync(agree) ? 'done' : 'not done'}`;
  };
  for (const s of draw.strata) {
    const rej = s.attempts.filter((a) => a.status.startsWith('rejected')).length;
    const other = s.attempts.filter((a) => a.status !== 'drawn' && !a.status.startsWith('rejected')).length;
    const keptNote = s.zone && s.attempts.at(-1)?.keptFrom ? ' (kept from v1)' : '';
    L.push(`| ${s.stratum} | ${s.eligible} | ${s.attempts.length} | ${rej} | ${other} | ${s.zone ? s.zone + keptNote : s.exhausted ? 'none: every eligible municipality tried' : 'drawing'} | ${labelState(s.zone)} |`);
  }
  L.push('');
  L.push(`Every attempt, with the municipality, the cell, the Esri capture where it applies and the reason it was skipped, is in \`zones/${base(pre.drawFile)}\`; the review note of each rejected zone is in \`labels/review/<zone>/NOTE.md\`.`);
  return L.join('\n') + '\n';
}
