/** The detectors the CLI can run: v2 with the shipped model (default), or v1. */
import { createV1Detector, createV2Detector, type Detector, type PoolModel } from '@marco-polo/core';
import model from '@marco-polo/core/models/pool-v2.json';

export type DetectorChoice = 'v1' | 'v2';

export function makeDetector(choice: DetectorChoice): Detector {
  if (choice === 'v1') return createV1Detector();
  return createV2Detector(model as unknown as PoolModel);
}
