/**
 * Builds zones/test-candidates.json: the pre-registered list of municipalities
 * the TEST zones are drawn from. It reads administrative data only (names,
 * official codes, populations, centres); no imagery is fetched here.
 *
 * The file is committed before any imagery of a candidate is looked at, and
 * the draw (lottery.ts) hashes the commit that added it. Never edit the file
 * after that commit: a changed list is a new pre-registration.
 */
import { statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sleep } from '../../cli/src/tiles.js';
import { overpass, UA, type OsmElement } from './overpass.js';

export type SourceId = 'dgt' | 'pnoa' | 'ign' | 'esri';

export interface Candidate {
  name: string;
  /** Official code: INE (PT, ES), INSEE (FR), Census GEOID (US), ISTAT (IT). */
  code: string;
  country: 'PT' | 'ES' | 'FR' | 'US' | 'IT';
  /** Centre used for the distance rule, [lat, lon], 5 decimals. */
  center: [number, number];
  population: number | null;
  /** Province, department or state code, for the acquisition rule. */
  region: string;
}

export interface Stratum {
  id: string;
  source: SourceId | 'auto';
  definition: string;
  /** Cells must have at least this share of their area inside these OSM features. */
  cellFeatures: string;
  reportedApart: boolean;
  candidates: Candidate[];
}

export const RULES = {
  minDistanceKm: 50,
  cellSizeKm: 1,
  cellMinShare: 0.3,
  minPools: 40,
  municipalityIndex:
    'i = BigInt("0x" + sha256_hex(utf8("<listCommit>:<stratum>"))) mod n, where listCommit is the full hash of the commit that added this file and n the number of eligible candidates of the stratum in file order',
  cellIndex:
    'j = BigInt("0x" + sha256_hex(utf8("<listCommit>:<stratum>:cell:<code>"))) mod m, over the eligible cells of the municipality in grid order',
  order: 'strata are drawn in the order of this file',
  eligibleMunicipality:
    'centre at least minDistanceKm from every zone of zones/registry.json (any role, TEST zones drawn before included) and every seen site listed there, and its region not in excludedRegions for the stratum',
  grid:
    'square cells of cellSizeKm ground km laid from the south-west corner of the municipality bounding box, rows south to north, cells west to east within a row',
  eligibleCell:
    'cell centre inside the municipality boundary, at least minDistanceKm from every protected site, and at least cellMinShare of a 21 x 21 lattice of points (50 m spacing) inside the stratum features (OSM, fetched at draw time and saved next to the draw)',
  next:
    'if the municipality has no eligible cell, or (hard stratum) the Esri metadata at the cell centre does not meet the condition, or the zone has fewer than minPools pools after the blind review (all strata except negative), take i + 1 mod n and repeat',
  hardCondition:
    'Esri World Imagery metadata at the cell centre (World_Imagery MapServer layer 9, "30cm Resolution Metadata", the z19 level; SRC_DATE2): capture date from November to February, or solar elevation at local solar noon on the capture date below 35 degrees (90 - |lat - d|, d = 23.44 * sin(360 / 365 * (284 + day of year)) degrees)',
  acquisition:
    'Esri strata: the capture (SRC_DATE2 and SRC_DESC) at the cell centre differs from every DEV and DEV-2 Esri zone. PNOA and IGN: excluded regions below (provinces and departments of DEV, DEV-2, GOLD and training zones). DGT 2025: one national flight, the distance rule applies',
} as const;

const EXCLUDED_REGIONS: Record<string, string[]> = {
  // Madrid (Pozuelo, Torrelodones), Malaga (Marbella), Sevilla (Bormujos), Valencia (L'Eliana).
  es: ['28', '29', '41', '46'],
  // Alpes-Maritimes (Mougins), Bouches-du-Rhone (Aix), Haute-Garonne (Balma, Tournefeuille), Herault (Castelnau, Grabels, Saint-Gely).
  fr: ['06', '13', '31', '34'],
  negative: ['ES-28', 'ES-29', 'ES-41', 'ES-46', 'FR-06', 'FR-13', 'FR-31', 'FR-34'],
};
export { EXCLUDED_REGIONS };

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Raw answers are kept outside the repo so a failed step does not redo the others. */
let rawDir: string | null = null;

async function cached<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  if (rawDir) {
    try {
      return JSON.parse(await readFile(join(rawDir, `${name}.json`), 'utf8')) as T;
    } catch {
      // not fetched yet
    }
  }
  const value = await fetcher();
  if (rawDir) {
    await mkdir(rawDir, { recursive: true });
    await writeFile(join(rawDir, `${name}.json`), JSON.stringify(value), 'utf8');
  }
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (res.ok) return (await res.json()) as T;
    } catch {
      // retry
    }
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`failed: ${url}`);
}

const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

function fromOsm(el: OsmElement, country: Candidate['country'], codeTag: string, regionOf: (code: string) => string): Candidate | null {
  const code = el.tags?.[codeTag];
  if (!code || !el.center) return null;
  return {
    name: el.tags?.name ?? code,
    code,
    country,
    center: [round5(el.center.lat), round5(el.center.lon)],
    population: num(el.tags?.population),
    region: regionOf(code),
  };
}

const byCode = (a: Candidate, b: Candidate) => a.code.localeCompare(b.code);

async function portugal(): Promise<Candidate[]> {
  const els = await cached('pt', () =>
    overpass(
      '[out:json][timeout:180];area["ISO3166-1"="PT"][admin_level=2]->.a;' +
        'rel(area.a)[boundary=administrative][admin_level=7]["ref:ine"];out tags center;',
    ),
  );
  return els.map((e) => fromOsm(e, 'PT', 'ref:ine', (c) => c.slice(0, 2))).filter((c): c is Candidate => !!c).sort(byCode);
}

async function spain(name: string, filter: string): Promise<Candidate[]> {
  const els = await cached(name, () =>
    overpass(
      '[out:json][timeout:300];area["ISO3166-1"="ES"][admin_level=2]->.a;' +
        `rel(area.a)[boundary=administrative][admin_level=8]["ine:municipio"]${filter};out tags center;`,
    ),
  );
  return els.map((e) => fromOsm(e, 'ES', 'ine:municipio', (c) => c.slice(0, 2))).filter((c): c is Candidate => !!c).sort(byCode);
}

async function italy(): Promise<Candidate[]> {
  const els = await cached('it', () =>
    overpass(
      '[out:json][timeout:300];area["ISO3166-1"="IT"][admin_level=2]->.a;' +
        'rel(area.a)[boundary=administrative][admin_level=8]["ref:ISTAT"]' +
        '(if: is_number(t["population"]) && number(t["population"]) >= 10000 && number(t["population"]) <= 100000);out tags center;',
    ),
  );
  return els.map((e) => fromOsm(e, 'IT', 'ref:ISTAT', (c) => c.slice(0, 3))).filter((c): c is Candidate => !!c).sort(byCode);
}

interface Commune {
  nom: string;
  code: string;
  population?: number;
  centre?: { coordinates: [number, number] };
  codeDepartement: string;
}

async function france(): Promise<Candidate[]> {
  const list = await cached('fr', () => getJson<Commune[]>('https://geo.api.gouv.fr/communes?fields=nom,code,population,centre,codeDepartement&format=json'));
  return list
    .filter((c) => c.centre && !c.codeDepartement.startsWith('97'))
    .map((c) => ({
      name: c.nom,
      code: c.code,
      country: 'FR' as const,
      center: [round5(c.centre!.coordinates[1]), round5(c.centre!.coordinates[0])] as [number, number],
      population: c.population ?? null,
      region: c.codeDepartement,
    }))
    .sort(byCode);
}

const US_STATES: Record<string, string> = { '06': 'CA', '12': 'FL', '32': 'NV', '48': 'TX' };

async function unitedStates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const st of Object.keys(US_STATES)) {
    const where = `STATE='${st}' AND POP100>=10000 AND POP100<=100000 AND FUNCSTAT='A'`;
    const url =
      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/25/query?' +
      new URLSearchParams({ where, outFields: 'GEOID,NAME,STATE,POP100,INTPTLAT,INTPTLON', returnGeometry: 'false', f: 'json' });
    const j = await cached(`us-${st}`, () => getJson<{ features: Array<{ attributes: Record<string, string | number> }> }>(url));
    for (const f of j.features) {
      const a = f.attributes;
      out.push({
        name: `${a.NAME}, ${US_STATES[st]}`,
        code: String(a.GEOID),
        country: 'US',
        center: [round5(Number(a.INTPTLAT)), round5(Number(a.INTPTLON))],
        population: Number(a.POP100),
        region: st,
      });
    }
    await sleep(1500);
  }
  return out.sort(byCode);
}

/** Ports, marinas and industrial waterfronts, picked by name before any imagery was opened. */
const NEGATIVE = {
  PT: ['Setúbal', 'Sines', 'Figueira da Foz', 'Ílhavo', 'Peniche', 'Portimão', 'Olhão', 'Nazaré'],
  ES: ['Algeciras', 'Cartagena', 'Huelva', 'Tarragona', 'Vigo', 'Ferrol', 'Santander', 'Almería', 'Motril'],
  // Name and department: several communes share a name.
  FR: ['Le Havre|76', 'La Rochelle|17', 'Lorient|56', 'Saint-Nazaire|44', 'Brest|29', 'Cherbourg-en-Cotentin|50', 'Dunkerque|59', 'Boulogne-sur-Mer|62', "Les Sables-d'Olonne|85", 'Port-Vendres|66'],
};

const inPop = (c: Candidate, lo: number, hi: number) => c.population !== null && c.population >= lo && c.population <= hi;

export async function buildCandidates(): Promise<{ strata: Stratum[]; fetched: Record<string, string> }> {
  const fetched: Record<string, string> = {};
  const stamp = (k: string, raw: string) => {
    let when = new Date();
    if (rawDir) {
      try {
        when = statSync(join(rawDir, `${raw}.json`)).mtime;
      } catch {
        // fetched just now
      }
    }
    fetched[k] = when.toISOString().slice(0, 19) + 'Z';
  };

  console.log('Portugal (Overpass)');
  const pt = await portugal();
  stamp('PT: Overpass, admin_level=7 relations with ref:ine', 'pt');
  if (!rawDir) await sleep(10_000);
  console.log('Spain (Overpass)');
  const es = await spain('es', '(if: is_number(t["population"]) && number(t["population"]) >= 10000 && number(t["population"]) <= 100000)');
  stamp('ES: Overpass, admin_level=8 relations with ine:municipio', 'es');
  if (!rawDir) await sleep(10_000);
  const esNames = NEGATIVE.ES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const esNeg = await spain('es-negative', `[name~"^(${esNames})$"]`);
  if (!rawDir) await sleep(10_000);
  console.log('Italy (Overpass)');
  const it = await italy();
  stamp('IT: Overpass, admin_level=8 relations with ref:ISTAT', 'it');
  console.log('France (geo.api.gouv.fr)');
  const fr = await france();
  stamp('FR: geo.api.gouv.fr/communes', 'fr');
  console.log('United States (TIGERweb, Census 2020)');
  const us = await unitedStates();
  stamp('US: TIGERweb Census 2020 incorporated places', 'us-06');

  const ptMainland = pt.filter((c) => Number(c.region) >= 1 && Number(c.region) <= 18);
  const north = new Set(['03', '04', '13', '16', '17']);
  const pick = (list: Candidate[], names: string[], tag: string): Candidate[] =>
    names.map((key) => {
      const [n, region] = key.split('|');
      const hit = list.filter((c) => c.name === n && (!region || c.region === region));
      if (hit.length !== 1) throw new Error(`negative ${tag} "${key}": ${hit.length} matches`);
      return { ...hit[0], region: `${tag}-${hit[0].region}` };
    });

  const strata: Stratum[] = [
    {
      id: 'pt-north',
      source: 'dgt',
      definition:
        'Portuguese municipalities of the districts Braga (03), Braganca (04), Porto (13), Viana do Castelo (16) and Vila Real (17), first two digits of the INE code, population at least 15000 (OSM population tag, 2021 census). Centre: OSM relation bounding-box centre.',
      cellFeatures: 'landuse=residential',
      reportedApart: false,
      candidates: ptMainland.filter((c) => north.has(c.region) && inPop(c, 15000, Infinity)),
    },
    {
      id: 'pt-rest',
      source: 'dgt',
      definition:
        'Portuguese mainland municipalities of every other district (01 to 18 except the five above), population at least 15000 (OSM population tag, 2021 census). Centre: OSM relation bounding-box centre.',
      cellFeatures: 'landuse=residential',
      reportedApart: false,
      candidates: ptMainland.filter((c) => !north.has(c.region) && inPop(c, 15000, Infinity)),
    },
    {
      id: 'es',
      source: 'pnoa',
      definition:
        'Spanish municipalities with population 10000 to 100000 (OSM population tag), except the Canary Islands (35, 38), Ceuta (51) and Melilla (52), and except the provinces in excludedRegions (acquisition rule). Centre: OSM relation bounding-box centre.',
      cellFeatures: 'landuse=residential',
      reportedApart: false,
      candidates: es.filter((c) => !['35', '38', '51', '52'].includes(c.region)),
    },
    {
      id: 'fr',
      source: 'ign',
      definition:
        'Communes of metropolitan France with population 10000 to 100000 (geo.api.gouv.fr), except the departments in excludedRegions (acquisition rule). Centre: geo.api.gouv.fr centre.',
      cellFeatures: 'landuse=residential',
      reportedApart: false,
      candidates: fr.filter((c) => inPop(c, 10000, 100000)),
    },
    {
      id: 'us',
      source: 'esri',
      definition:
        'Incorporated places (FUNCSTAT A) of California, Florida, Nevada and Texas with Census 2020 population 10000 to 100000 (TIGERweb). Arizona, where the DEV and DEV-2 US zones are, is not in the list. Centre: Census internal point.',
      cellFeatures: 'landuse=residential',
      reportedApart: false,
      candidates: us,
    },
    {
      id: 'negative',
      source: 'auto',
      definition:
        'Port, marina and industrial waterfront municipalities picked by name before any imagery was opened, with the code from the same administrative sources. Reported apart, not in the totals; the minPools rule does not apply.',
      cellFeatures: 'landuse=port, landuse=industrial or leisure=marina',
      reportedApart: true,
      candidates: [...pick(pt, NEGATIVE.PT, 'PT'), ...pick(esNeg, NEGATIVE.ES, 'ES'), ...pick(fr, NEGATIVE.FR, 'FR')],
    },
    {
      id: 'hard',
      source: 'esri',
      definition:
        'Italian municipalities with population 10000 to 100000 (OSM population tag, ref:ISTAT), where the product scans Esri; a cell enters only if the Esri metadata meets hardCondition. Reported apart, not in the totals. Centre: OSM relation bounding-box centre.',
      cellFeatures: 'landuse=residential',
      reportedApart: true,
      candidates: it,
    },
  ];
  return { strata, fetched };
}

export async function writeCandidates(path: string, cacheDir?: string): Promise<void> {
  rawDir = cacheDir ?? null;
  const { strata, fetched } = await buildCandidates();
  const file = {
    about:
      'Pre-registered TEST candidates. Committed before any imagery of these places was opened; the draw hashes the commit that added this file. Administrative data only. OSM-derived names and codes: (c) OpenStreetMap contributors, ODbL 1.0.',
    rules: RULES,
    excludedRegions: EXCLUDED_REGIONS,
    fetched,
    strata: strata.map((s) => ({ ...s, n: s.candidates.length })),
  };
  await writeFile(path, compactCandidates(file) + '\n', 'utf8');
  for (const s of strata) console.log(`${s.id.padEnd(9)} ${s.candidates.length} candidates`);
}

/** JSON with every candidate on one line. */
export function compactCandidates(file: { strata: Array<{ candidates: unknown[] }> } & Record<string, unknown>): string {
  const copy = { ...file, strata: file.strata.map((s, i) => ({ ...s, candidates: `@@candidates-${i}@@` })) };
  let text = JSON.stringify(copy, null, 1);
  file.strata.forEach((s, i) => {
    const body = '[' + String.fromCharCode(10) + s.candidates.map((c) => '   ' + JSON.stringify(c)).join(',' + String.fromCharCode(10)) + String.fromCharCode(10) + '  ]';
    text = text.replace(`"@@candidates-${i}@@"`, () => body);
  });
  return text;
}
