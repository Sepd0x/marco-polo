/**
 * The score a pool needs to be listed. As in the web app, each source uses
 * the threshold the model was calibrated to on it, unless one value is asked
 * for, which then holds for every source.
 */
import { thresholds } from '@marco-polo/core/models/pool-v2.json';
import { sourceFamily } from '@marco-polo/core';

type Thresholds = Record<string, number | undefined>;

/** The calibrated threshold for a source, or the model default when the source is unknown. */
export function recommendedFor(providerId: string | null | undefined): number {
  const t = thresholds as Thresholds;
  const fam = providerId ? sourceFamily(providerId) : 'default';
  return t[fam] ?? t.default ?? 0.5;
}
