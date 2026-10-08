/**
 * The detector the product runs, with the shipped model. Only the detection
 * worker imports this, so the model stays out of the main bundle.
 */
import { createV2Detector, DEFAULT_HALO_PX, type Detector, type PoolModel } from '@marco-polo/core';
import model from '@marco-polo/core/models/pool-v2.json';
import { PRODUCT_DETECTOR_ID, V2_HALO_PX } from './tileWork.js';

if (DEFAULT_HALO_PX !== V2_HALO_PX) throw new Error('halo of the scan and of the detector differ');

export function productDetector(): Detector {
  const d = createV2Detector(model as unknown as PoolModel);
  if (d.id !== PRODUCT_DETECTOR_ID) throw new Error(`product detector is ${d.id}, expected ${PRODUCT_DETECTOR_ID}`);
  return d;
}
