import type { SourceId } from './candidates.js';
import { loadRegistry, ROLES, type Role, type ZoneDef } from './registry.js';

export type Zone = ZoneDef;

let cache: Zone[] | null = null;

/** Zones of the registry (packages/eval/zones/registry.json). */
export function allZones(): Zone[] {
  return (cache ??= loadRegistry().zones);
}

export function zoneById(id: string): Zone {
  const zone = allZones().find((z) => z.id === id);
  if (!zone) throw new Error(`unknown area ${id} (known: ${allZones().map((z) => z.id).join(', ')})`);
  return zone;
}

const ROLE_ALIASES: Record<string, Role> = { dev: 'DEV', 'dev-2': 'DEV-2', dev2: 'DEV-2', gold: 'GOLD', test: 'TEST', train: 'TRAIN' };

/**
 * `--zones`: roles (dev, dev-2, gold, test), ids, or a comma list of both.
 * `default` is DEV and DEV-2, the zones the phase 0 table covers.
 */
export function selectZones(spec: string): Zone[] {
  const parts = spec === 'default' ? ['dev', 'dev-2'] : spec === 'all' ? ROLES.filter((r) => r !== 'TRAIN').map((r) => r.toLowerCase()) : spec.split(',').map((s) => s.trim()).filter(Boolean);
  const out: Zone[] = [];
  for (const p of parts) {
    const role = ROLE_ALIASES[p.toLowerCase()];
    const picked = role ? allZones().filter((z) => z.role === role) : [zoneById(p)];
    for (const z of picked) if (!out.includes(z)) out.push(z);
  }
  return out;
}

/** Source a zone is scanned on for `--source`: `auto` is the product source of the zone. */
export function sourceFor(zone: Zone, spec: SourceId | 'auto'): SourceId {
  return spec === 'auto' ? zone.productSource : spec;
}

/**
 * How to move this zone's labels onto `source`: OSM features by the measured
 * OSM shift, hand labels by the shift between the source they were drawn on
 * and this one. Null when a needed shift has not been measured.
 */
export function shiftsFor(zone: Zone, source: SourceId): { osm: [number, number]; visual: [number, number] } | null {
  if (zone.review === 'blind') {
    // Blind label files hold everything, OSM included, already on the source they were reviewed on.
    const s: [number, number] | undefined = source === zone.labelSource ? [0, 0] : zone.labelShiftM?.[source];
    return s ? { osm: s, visual: s } : null;
  }
  const osm = zone.osmShiftM?.[source];
  const visual: [number, number] | undefined = source === zone.labelSource ? [0, 0] : zone.labelShiftM?.[source];
  if (!osm || !visual) return null;
  return { osm, visual };
}
