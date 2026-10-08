import { describe, expect, it } from 'vitest';
import {
  captureLookup,
  parseEsriMetadata,
  parseIgnFeatureInfo,
  parsePnoaFeatureInfo,
  staticCaptureInfo,
  toPtTm06,
} from '../src/imagery/dates.js';
import {
  attributionFor,
  attributionLines,
  csvCell,
  googleMapsUrl,
  partSummary,
  provenanceOf,
  stripSecrets,
  toCSV,
  toGeoJSON,
  toResultDetection,
} from '../src/export.js';
import { DGT_ORTOS2025, DGT_ORTOSAT2023, ESRI_WORLD_IMAGERY, IGN_ORTHOPHOTOS, PNOA } from '../src/providers.js';
import type { RankedDetection, Ring, ScanResult } from '../src/types.js';

describe('PT-TM06 coordinates', () => {
  // Reference values from PROJ (pyproj 3, EPSG:4326 to EPSG:3763), 7 Oct 2026.
  const refs: [number, number, number, number][] = [
    [-8.42, 41.55, -23935.93330267024, 209000.341388385],
    [-9.14, 38.72, -87567.12290642294, -104793.55537643725],
    [-7.93, 37.02, 18074.28655098665, -293945.45289732865],
    [-8.0, 40.73, 11244.67141027249, 117902.690053366],
    [-6.2, 41.9, 160413.354820272, 249641.96196074173],
  ];
  for (const [lon, lat, m, p] of refs) {
    it(`matches PROJ within 1 cm at ${lat}, ${lon}`, () => {
      const [x, y] = toPtTm06(lon, lat);
      expect(Math.abs(x - m)).toBeLessThan(0.01);
      expect(Math.abs(y - p)).toBeLessThan(0.01);
    });
  }
});

describe('capture dates', () => {
  it('gives each Ortos2025 lot its published dates', () => {
    expect(staticCaptureInfo(DGT_ORTOS2025, { lat: 41.55, lon: -8.42 })?.date).toBe('2025-03-31/2025-07-26'); // lot 1
    expect(staticCaptureInfo(DGT_ORTOS2025, { lat: 40.73, lon: -8.0 })?.date).toBe('2025-03-29/2025-07-26'); // lot 2
    const lisboa = staticCaptureInfo(DGT_ORTOS2025, { lat: 38.72, lon: -9.14 })!;
    expect(lisboa.date).toBe('2025-04-26/2025-07-15'); // lot 3
    expect(lisboa.sensor).toBe('UltraCam Falcon F100');
    expect(staticCaptureInfo(DGT_ORTOS2025, { lat: 37.02, lon: -7.93 })?.date).toBe('2025-05-24/2025-07-25'); // lot 4
    expect(staticCaptureInfo(DGT_ORTOSAT2023, { lat: 38.7, lon: -9.1 })?.date).toBe('2023-04/2023-10');
    expect(staticCaptureInfo(ESRI_WORLD_IMAGERY, { lat: 0, lon: 0 })).toBeNull();
  });

  it('reads the Esri record whose level range holds the scan zoom', () => {
    // Shape of a services.arcgisonline.com metadata query answer (Braga, layer 9).
    const body = JSON.stringify({
      features: [
        { attributes: { SRC_DATE2: 1657843200000, SRC_RES: 0.25, SRC_DESC: 'X', MinMapLevel: 20, MaxMapLevel: 20 } },
        { attributes: { SRC_DATE2: 1759622400000, SRC_RES: 0.5, SRC_DESC: 'WV02', MinMapLevel: 12, MaxMapLevel: 19 } },
      ],
    });
    expect(parseEsriMetadata(body, 19)).toEqual({
      date: '2025-10-05',
      resolutionM: 0.5,
      sensor: 'WV02',
      basis: 'Esri World Imagery metadata',
    });
    expect(parseEsriMetadata(body, 20)?.date).toBe('2022-07-15');
    expect(parseEsriMetadata('{"features":[]}', 19)).toBeNull();
    expect(parseEsriMetadata('<html>error</html>', 19)).toBeNull();
  });

  it('reads PNOA and IGN feature info', () => {
    const pnoa = '{"type":"FeatureCollection","features":[{"type":"Feature","id":"","geometry":null,"properties":{"Fecha":"2022-07","Resolucion":"0.25"}}]}';
    expect(parsePnoaFeatureInfo(pnoa)).toEqual({ date: '2022-07', resolutionM: 0.25, sensor: null, basis: 'PNOA OI.MosaicElement' });
    expect(parsePnoaFeatureInfo('{"features":[]}')).toBeNull();
    const ign = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { dep: '06', pva: 2023, res: 20, date_vol: '2023-07-10Z' } }],
    });
    expect(parseIgnFeatureInfo(ign)).toEqual({ date: '2023-07-10', resolutionM: 0.2, sensor: null, basis: 'IGN BD ORTHO mosaic graph' });
    expect(parseIgnFeatureInfo('{"type":"FeatureCollection","features":[]}')).toBeNull();
  });

  it('builds metadata requests for the sources that have them', () => {
    const esri = captureLookup(ESRI_WORLD_IMAGERY, { lat: 41.559, lon: -8.384 }, 19)!;
    expect(esri.urls).toHaveLength(2);
    expect(esri.urls[0]).toMatch(/^https:\/\/services\.arcgisonline\.com\/.*\/MapServer\/9\/query\?geometry=-8\.384000%2C41\.559000/);
    const ign = captureLookup(IGN_ORTHOPHOTOS, { lat: 43.6, lon: 7.0 }, 19)!.urls[0];
    const i = Number(/&I=(\d+)/.exec(ign)![1]);
    const j = Number(/&J=(\d+)/.exec(ign)![1]);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(256);
    expect(j).toBeLessThan(256);
    expect(ign).toContain('TILEMATRIX=19&');
    expect(captureLookup(PNOA, { lat: 36.49, lon: -4.96 }, 19)!.urls[0]).toContain('QUERY_LAYERS=OI.MosaicElement');
    expect(captureLookup(DGT_ORTOS2025, { lat: 41, lon: -8 }, 18)).toBeNull();
  });
});

function detection(overrides: Partial<RankedDetection> = {}): RankedDetection {
  // A 10 x 5 m axis-aligned rectangle near Lisboa.
  const lat = 38.7, lon = -9.14;
  const dLat = 2.5 / 111320, dLon = 5 / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring: Ring = [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat]];
  return {
    id: 'd1',
    kind: 'pool',
    center: { lon, lat },
    bbox: { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat },
    outline: [ring],
    areaM2: 50,
    confidence: 0.91234,
    pixelCount: 800,
    tiles: [{ z: 19, x: 1, y: 1 }],
    truncated: false,
    primary: { tile: { z: 19, x: 1, y: 1 }, bboxPx: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
    meanHue: 188,
    meanSat: 0.6,
    meanVal: 0.7,
    strictRatio: 0.9,
    fillRatio: 1,
    texture: 0.01,
    rank: 1,
    ...overrides,
  };
}

function result(): ScanResult {
  const prov = provenanceOf(DGT_ORTOS2025, 'p1', 18, '2025-04-26/2025-07-15');
  const provP = provenanceOf(PNOA, 'p2', 19, '2022-07');
  return {
    formatVersion: 2,
    createdAt: '2026-10-07T20:00:00.000Z',
    area: [[-9.15, 38.69], [-9.13, 38.69], [-9.13, 38.71]],
    threshold: 0.55,
    parts: [partSummary('p1', prov, 40, 2, 120_000), partSummary('p2', provP, 10, 0, 10_000)],
    detections: [
      toResultDetection(detection(), prov),
      toResultDetection(detection({ id: 'd2', rank: 2, truncated: true }), provP),
    ],
    belowThreshold: 3,
  };
}

describe('result export', () => {
  it('measures dimensions from the outline and skips cut shapes', () => {
    const r = result();
    const d = r.detections[0].dims!;
    expect(d.lengthM).toBeCloseTo(10, 1);
    expect(d.widthM).toBeCloseTo(5, 1);
    expect(d.angleDeg).toBeCloseTo(90, 0);
    expect(r.detections[1].dims).toBeNull();
  });

  it('writes GeoJSON with provenance, attribution and no URL templates', () => {
    const json = toGeoJSON(result());
    const doc = JSON.parse(json);
    expect(doc.formatVersion).toBe(2);
    expect(doc.features).toHaveLength(2);
    const p = doc.features[0].properties;
    expect(p.source).toBe('dgt-ortos2025');
    expect(p.capture_date).toBe('2025-04-26/2025-07-15');
    expect(p.length_m).toBe(10);
    expect(doc.features[1].properties.length_m).toBeNull();
    expect(doc.parts[0].tiles_no_coverage).toBe(2);
    expect(doc.attribution).toEqual([
      DGT_ORTOS2025.attribution,
      'Obra derivada de PNOA 2022-07 CC-BY 4.0 scne.es',
    ]);
    const ring = doc.features[0].geometry.coordinates[0][0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(json).not.toMatch(/arcgisonline|dgterritorio|ign\.es|geopf|\{z\}|bbox-epsg/);
  });

  it('cannot be made to carry a key', () => {
    const r = result();
    const leaky = {
      ...r,
      detections: r.detections.map((d) => ({
        ...d,
        provenance: { ...d.provenance, providerName: 'Tiles https://x.test/{z}?api_key=SECRET123&style=a' },
        apiKey: 'SECRET123',
        template: 'https://x.test/{z}/{x}/{y}?access_token=SECRET123',
      })),
    } as unknown as ScanResult;
    expect(toGeoJSON(leaky)).not.toContain('SECRET123');
    expect(toCSV(leaky)).not.toContain('SECRET123');
    expect(stripSecrets({ a: 'x?token=abc&b=1', key: 'k' })).toEqual({ a: 'x?token=&b=1' });
  });

  it('writes CSV with one row per detection and safe cells', () => {
    const csv = toCSV(result());
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'rank,id,kind,lat,lon,area_m2,length_m,width_m,heading_deg,confidence,truncated,source,capture_date,native_res_m,part,google_maps,attribution',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(',-9.14,');
    expect(lines[1]).toContain(googleMapsUrl(38.7, -9.14));
    expect(lines[2]).toMatch(/,,,,/); // dims not measured
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });

  it('credits each source once, IGN with its date', () => {
    expect(attributionLines(result())).toHaveLength(2);
    expect(attributionFor(provenanceOf(IGN_ORTHOPHOTOS, 'p1', 19, '2023-07-10'))).toBe(
      'IGN, BD ORTHO (Géoplateforme), 2023-07-10, Licence Ouverte 2.0 (Etalab)',
    );
    expect(attributionFor(provenanceOf(ESRI_WORLD_IMAGERY, 'p1', 19, null))).toContain('Powered by Esri');
  });

  it('links Google Maps by coordinates only', () => {
    expect(googleMapsUrl(38.7, -9.14)).toBe('https://www.google.com/maps/search/?api=1&query=38.700000%2C-9.140000');
  });
});
