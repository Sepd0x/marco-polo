/**
 * Binary mask morphology and connected-component labelling.
 * Small, allocation-conscious implementations sized for 256×256 tiles.
 */

/**
 * 3×3 cross erosion — a pixel survives only if its 4-neighbourhood is set.
 * Out-of-image neighbours count as set (border replication): a shape that
 * touches the tile edge must keep touching it, or the cross-tile merger
 * loses the signal that the shape continues in the next tile.
 */
export function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const up = y > 0 ? mask[i - width] : 1;
      const down = y < height - 1 ? mask[i + width] : 1;
      const left = x > 0 ? mask[i - 1] : 1;
      const right = x < width - 1 ? mask[i + 1] : 1;
      if (up && down && left && right) out[i] = 1;
    }
  }
  return out;
}

/** 3×3 cross dilation. */
export function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      out[i] = 1;
      if (y > 0) out[i - width] = 1;
      if (y < height - 1) out[i + width] = 1;
      if (x > 0) out[i - 1] = 1;
      if (x < width - 1) out[i + 1] = 1;
    }
  }
  return out;
}

/**
 * Morphological open (erode→dilate) to drop speckle noise, then close
 * (dilate→erode) to seal small holes from sun glint, steps and lane lines.
 */
export function cleanMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  let m = erode(mask, width, height);
  m = dilate(m, width, height);
  m = dilate(m, width, height);
  m = erode(m, width, height);
  return m;
}

export interface Component {
  label: number;
  pixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
}

export interface LabelResult {
  labels: Int32Array;
  components: Component[];
}

/** 8-connected component labelling via iterative flood fill (labels start at 1). */
export function labelComponents(mask: Uint8Array, width: number, height: number): LabelResult {
  const labels = new Int32Array(mask.length);
  const components: Component[] = [];
  const stack: number[] = [];
  let next = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    const comp: Component = {
      label: next,
      pixelCount: 0,
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      sumX: 0,
      sumY: 0,
    };
    stack.length = 0;
    stack.push(start);
    labels[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i / width) | 0;
      comp.pixelCount++;
      comp.sumX += x;
      comp.sumY += y;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      const x0 = x > 0 ? -1 : 0;
      const x1 = x < width - 1 ? 1 : 0;
      const y0 = y > 0 ? -1 : 0;
      const y1 = y < height - 1 ? 1 : 0;
      for (let dy = y0; dy <= y1; dy++) {
        for (let dx = x0; dx <= x1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const j = i + dy * width + dx;
          if (mask[j] && !labels[j]) {
            labels[j] = next;
            stack.push(j);
          }
        }
      }
    }
    components.push(comp);
  }
  return { labels, components };
}
