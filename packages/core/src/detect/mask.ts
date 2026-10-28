/**
 * Binary mask morphology and connected-component labelling.
 * Small, allocation-conscious implementations sized for 256×256 tiles.
 */

/**
 * Scratch buffers for the intermediate masks of `cleanMask`, kept between
 * calls (a window runs it once per colour level and per split part).
 */
let scratchA = new Uint8Array(0);
let scratchB = new Uint8Array(0);

function scratch(n: number): [Uint8Array, Uint8Array] {
  if (scratchA.length < n) {
    scratchA = new Uint8Array(n);
    scratchB = new Uint8Array(n);
  }
  return [scratchA.subarray(0, n), scratchB.subarray(0, n)];
}

/** 32-bit view of a byte mask when it is word-aligned, so runs of empty pixels are skipped 4 at a time. */
function words(m: Uint8Array): Uint32Array | null {
  return m.byteOffset % 4 === 0 ? new Uint32Array(m.buffer, m.byteOffset, m.length >> 2) : null;
}

/** `erode` written into `out` (which must not be `mask`). */
function erodeInto(mask: Uint8Array, width: number, height: number, out: Uint8Array): void {
  out.fill(0);
  const n = width * height;
  const lastRow = n - width;
  const w32 = words(mask);
  const nw = w32 ? w32.length : 0;
  let i = 0;
  let rowEnd = width;
  for (;;) {
    if (w32) {
      let j = i >> 2;
      while (j < nw && w32[j] === 0) j++;
      if (j << 2 > i) i = j << 2;
    }
    if (i >= n) break;
    const end = Math.min(n, (i | 3) + 1);
    for (; i < end; i++) {
      if (!mask[i]) continue;
      while (i >= rowEnd) rowEnd += width;
      const x = i - (rowEnd - width);
      if (
        (i < width || mask[i - width]) &&
        (i >= lastRow || mask[i + width]) &&
        (x === 0 || mask[i - 1]) &&
        (x === width - 1 || mask[i + 1])
      ) {
        out[i] = 1;
      }
    }
  }
}

/** `dilate` written into `out` (which must not be `mask`). */
function dilateInto(mask: Uint8Array, width: number, height: number, out: Uint8Array): void {
  out.fill(0);
  const n = width * height;
  const lastRow = n - width;
  const w32 = words(mask);
  const nw = w32 ? w32.length : 0;
  let i = 0;
  let rowEnd = width;
  for (;;) {
    if (w32) {
      let j = i >> 2;
      while (j < nw && w32[j] === 0) j++;
      if (j << 2 > i) i = j << 2;
    }
    if (i >= n) break;
    const end = Math.min(n, (i | 3) + 1);
    for (; i < end; i++) {
      if (!mask[i]) continue;
      while (i >= rowEnd) rowEnd += width;
      const x = i - (rowEnd - width);
      out[i] = 1;
      if (i >= width) out[i - width] = 1;
      if (i < lastRow) out[i + width] = 1;
      if (x > 0) out[i - 1] = 1;
      if (x < width - 1) out[i + 1] = 1;
    }
  }
}

/**
 * 3x3 cross erosion: a pixel survives only if its 4-neighbourhood is set.
 * Out-of-image neighbours count as set (border replication): a shape that
 * touches the tile edge must keep touching it, or the cross-tile merger
 * loses the signal that the shape continues in the next tile.
 */
export function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  erodeInto(mask, width, height, out);
  return out;
}

/** 3×3 cross dilation. */
export function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  dilateInto(mask, width, height, out);
  return out;
}

/**
 * Morphological open (erode, then dilate) to drop speckle noise, then close
 * (dilate, then erode) to seal small holes from sun glint, steps and lane lines.
 */
export function cleanMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const n = width * height;
  const [a, b] = scratch(n);
  const out = new Uint8Array(mask.length);
  erodeInto(mask, width, height, a);
  dilateInto(a, width, height, b);
  dilateInto(b, width, height, a);
  erodeInto(a, width, height, out);
  return out;
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

/** Flood-fill stack, kept between calls. */
let fillStack = new Int32Array(4096);

/**
 * 8-connected component labelling via iterative flood fill (labels start at
 * 1, in raster order of each component's first pixel).
 */
export function labelComponents(mask: Uint8Array, width: number, height: number): LabelResult {
  const labels = new Int32Array(mask.length);
  const components: Component[] = [];
  const n = Math.min(mask.length, width * height);
  const lastX = width - 1;
  const lastY = height - 1;
  const w32 = words(mask);
  const nw = w32 ? Math.min(w32.length, n >> 2) : 0;
  let stack = fillStack;
  let next = 0;

  let start = 0;
  for (;;) {
    if (w32) {
      let j = start >> 2;
      while (j < nw && w32[j] === 0) j++;
      if (j << 2 > start) start = j << 2;
    }
    if (start >= n) break;
    const blockEnd = Math.min(n, (start | 3) + 1);
    for (; start < blockEnd; start++) {
      if (!mask[start] || labels[start]) continue;
      next++;
      let count = 0, sumX = 0, sumY = 0;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = next;
      while (sp) {
        const i = stack[--sp];
        const y = (i / width) | 0;
        const x = i - y * width;
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // At most 8 pushes: grow first so the pushes below need no check.
        if (sp + 8 > stack.length) {
          const grown = new Int32Array(stack.length * 2);
          grown.set(stack);
          stack = fillStack = grown;
        }
        if (x > 0 && x < lastX && y > 0 && y < lastY) {
          let j = i - width - 1;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j++;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j++;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j = i - 1;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j = i + 1;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j = i + width - 1;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j++;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          j++;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
          continue;
        }
        const x0 = x > 0 ? -1 : 0;
        const x1 = x < lastX ? 1 : 0;
        const y0 = y > 0 ? -1 : 0;
        const y1 = y < lastY ? 1 : 0;
        for (let dy = y0; dy <= y1; dy++) {
          for (let dx = x0; dx <= x1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = i + dy * width + dx;
            if (mask[j] && !labels[j]) {
              labels[j] = next;
              stack[sp++] = j;
            }
          }
        }
      }
      components.push({ label: next, pixelCount: count, minX, minY, maxX, maxY, sumX, sumY });
    }
  }
  return { labels, components };
}
