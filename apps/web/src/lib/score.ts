/**
 * The minimum score a pool needs to be listed. By default each source uses
 * the threshold the model was calibrated to on it (the one the measured
 * numbers were taken at); moving the slider sets one value for every source.
 */
import { thresholds } from '@marco-polo/core/models/pool-v2.json';
import { sourceFamily, type RankedDetection } from '@marco-polo/core';
import { partOfDetection } from '../scan/ids.js';

export interface ScoreSettings {
  minConfidence: number;
  /** Use each source's calibrated threshold instead of `minConfidence`. */
  recommendedScore: boolean;
}

type Thresholds = Record<string, number | undefined>;

/** The calibrated threshold for a source, or the model default when the source is unknown. */
export function recommendedFor(providerId: string | null | undefined): number {
  const t = thresholds as Thresholds;
  const fam = providerId ? sourceFamily(providerId) : 'default';
  return t[fam] ?? t.default ?? 0.5;
}

/** The minimum each detection is held to, given the parts of its scan. */
export function cutoffFn(
  settings: ScoreSettings,
  parts: readonly { id: string; providerId: string }[],
): (d: Pick<RankedDetection, 'id'>) => number {
  if (!settings.recommendedScore) return () => settings.minConfidence;
  const byPart = new Map(parts.map((p) => [p.id, recommendedFor(p.providerId)]));
  const single = parts.length === 1 ? recommendedFor(parts[0].providerId) : recommendedFor(null);
  return (d) => {
    const part = partOfDetection(d.id);
    return (part ? byPart.get(part) : undefined) ?? single;
  };
}

/** The distinct cutoffs in use, lowest first: one value for a single source or a manual setting. */
export function cutoffsInUse(settings: ScoreSettings, parts: readonly { providerId: string }[]): number[] {
  if (!settings.recommendedScore) return [settings.minConfidence];
  const vals = parts.length ? parts.map((p) => recommendedFor(p.providerId)) : [recommendedFor(null)];
  return [...new Set(vals)].sort((a, b) => a - b);
}
