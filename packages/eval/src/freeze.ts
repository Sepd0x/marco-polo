/**
 * Frozen labels. `labels/labels.sha256` holds one sha256 per label file, in
 * sha256sum format. The harness refuses to run on a zone whose label files
 * differ from it unless the run passes `--relabel "<why>"`, which rewrites the
 * entries of those zones and appends the change to `labels/RELABEL_LOG.md`.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FREEZE_FILE = 'labels.sha256';
export const RELABEL_LOG = 'RELABEL_LOG.md';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Hash of a text file with line endings normalised, so a Windows checkout and CI agree. */
export const fileSha256 = (path: string) => sha256(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));

/** Label files that belong to a zone: `<zone>.geojson`, `<zone>.<anything>.geojson|json`. */
export function zoneLabelFiles(dir: string, zone: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f === `${zone}.geojson` || (f.startsWith(`${zone}.`) && /\.(geo)?json$/.test(f)))
    .sort();
}

export function readFreeze(dir: string, file = FREEZE_FILE): Map<string, string> {
  const path = join(dir, file);
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

export function writeFreeze(dir: string, entries: Map<string, string>, file = FREEZE_FILE): void {
  const lines = [...entries].sort((a, b) => a[0].localeCompare(b[0])).map(([f, h]) => `${h}  ${f}`);
  writeFileSync(join(dir, file), lines.join('\n') + '\n', 'utf8');
}

export interface FreezeProblem {
  zone: string;
  file: string;
  problem: 'changed' | 'not frozen' | 'missing';
}

export function checkFrozen(dir: string, zones: string[], file = FREEZE_FILE): FreezeProblem[] {
  const frozen = readFreeze(dir, file);
  const out: FreezeProblem[] = [];
  for (const zone of zones) {
    const files = zoneLabelFiles(dir, zone);
    for (const f of files) {
      const want = frozen.get(f);
      if (!want) out.push({ zone, file: f, problem: 'not frozen' });
      else if (want !== fileSha256(join(dir, f))) out.push({ zone, file: f, problem: 'changed' });
    }
    for (const f of frozen.keys()) {
      if ((f === `${zone}.geojson` || f.startsWith(`${zone}.`)) && !files.includes(f)) out.push({ zone, file: f, problem: 'missing' });
    }
  }
  return out;
}

/** Hash of the frozen entries of these zones: what a report records to say which labels it used. */
export function labelsHash(dir: string, zones: string[], file = FREEZE_FILE): string {
  const frozen = readFreeze(dir, file);
  const lines = [...frozen]
    .filter(([f]) => zones.some((z) => f === `${z}.geojson` || f.startsWith(`${z}.`)))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([f, h]) => `${h}  ${f}`);
  return sha256(lines.join('\n'));
}

/** Freeze the current label files of `zones` and log why. Returns the files whose hash changed. */
export function relabel(dir: string, zones: string[], reason: string, commit: string, file = FREEZE_FILE): string[] {
  if (!reason.trim()) throw new Error('--relabel needs a reason');
  const frozen = readFreeze(dir, file);
  const changed: string[] = [];
  for (const zone of zones) {
    for (const f of [...frozen.keys()]) {
      if ((f === `${zone}.geojson` || f.startsWith(`${zone}.`)) && !existsSync(join(dir, f))) {
        frozen.delete(f);
        changed.push(`${f} (removed)`);
      }
    }
    for (const f of zoneLabelFiles(dir, zone)) {
      const h = fileSha256(join(dir, f));
      if (frozen.get(f) !== h) changed.push(f);
      frozen.set(f, h);
    }
  }
  writeFreeze(dir, frozen, file);
  const log = join(dir, RELABEL_LOG);
  if (!existsSync(log)) writeFileSync(log, '# Label changes after a freeze\n\nOne entry per `--relabel`. Never edit past entries.\n', 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(log, `\n- ${date}, commit ${commit}, zones ${zones.join(', ')}: ${reason.trim()}\n  files: ${changed.length ? changed.join(', ') : 'none changed'}\n`, 'utf8');
  return changed;
}
