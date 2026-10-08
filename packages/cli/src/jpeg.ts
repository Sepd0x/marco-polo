/**
 * Baseline JPEG decoder that returns the same pixels as Chromium and Firefox.
 *
 * Both browsers decode with libjpeg-turbo using its defaults: the accurate
 * integer IDCT (jidctint.c), "fancy" triangle-filter chroma upsampling
 * (jdsample.c) and fixed-point YCbCr to RGB (jdcolor.c). jpeg-js uses a
 * different IDCT and nearest-neighbour chroma, which moves pixels by up to 13
 * levels, enough to change what the detector sees. Training and the benchmark
 * decode in Node, the product decodes in the browser, so Node has to match the
 * browser bit for bit. This file reproduces the libjpeg-turbo arithmetic for
 * the files our sources serve: baseline (SOF0/SOF1) Huffman, 8-bit samples,
 * 4:2:0, 4:2:2, 4:4:4 or greyscale. Anything else throws `JpegUnsupported`.
 */

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export class JpegUnsupported extends Error {}

/** Position in natural (row-major) order of the k-th coefficient in zigzag order. */
const NATURAL = new Int32Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63,
]);

const LOOKAHEAD = 9;

interface Huffman {
  /** For codes up to LOOKAHEAD bits: (length << 8) | symbol, or 0 when longer. */
  fast: Int32Array;
  maxcode: Int32Array;
  valoffset: Int32Array;
  values: Uint8Array;
}

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const fast = new Int32Array(1 << LOOKAHEAD);
  const maxcode = new Int32Array(18).fill(-1);
  const valoffset = new Int32Array(18);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1];
    if (n) {
      valoffset[len] = k - code;
      for (let i = 0; i < n; i++, k++, code++) {
        if (len <= LOOKAHEAD) {
          const shift = LOOKAHEAD - len;
          const base = code << shift;
          for (let j = 0; j < 1 << shift; j++) fast[base + j] = (len << 8) | values[k];
        }
      }
      maxcode[len] = code - 1;
    }
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff;
  return { fast, maxcode, valoffset, values };
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Blocks per row and per column, padded to whole MCUs. */
  bw: number;
  bh: number;
  /** Real (unpadded) sample size of this component. */
  dw: number;
  dh: number;
  coefs: Int32Array;
  dcPred: number;
  dcTable: Huffman | null;
  acTable: Huffman | null;
}

class BitReader {
  private buf = 0;
  private cnt = 0;
  /** Set once a marker is met: the rest of the scan reads zeros, as libjpeg does. */
  private atMarker = false;
  pos: number;

  constructor(
    private readonly data: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }

  private fill(): void {
    const d = this.data;
    while (this.cnt <= 24) {
      let byte = 0;
      if (!this.atMarker && this.pos < d.length) {
        byte = d[this.pos];
        if (byte === 0xff) {
          const next = this.pos + 1 < d.length ? d[this.pos + 1] : 0xd9;
          if (next === 0x00) {
            this.pos += 2;
          } else {
            this.atMarker = true;
            byte = 0;
          }
        } else {
          this.pos++;
        }
      }
      this.buf = ((this.buf << 8) | byte) >>> 0;
      this.cnt += 8;
    }
  }

  bits(n: number): number {
    if (n === 0) return 0;
    if (this.cnt < n) this.fill();
    this.cnt -= n;
    return (this.buf >>> this.cnt) & ((1 << n) - 1);
  }

  decode(t: Huffman): number {
    if (this.cnt < 16) this.fill();
    const look = (this.buf >>> (this.cnt - LOOKAHEAD)) & ((1 << LOOKAHEAD) - 1);
    const f = t.fast[look];
    if (f) {
      this.cnt -= f >> 8;
      return f & 0xff;
    }
    let len = LOOKAHEAD + 1;
    let code = (this.buf >>> (this.cnt - len)) & ((1 << len) - 1);
    while (len <= 16 && code > t.maxcode[len]) {
      len++;
      code = (this.buf >>> (this.cnt - len)) & ((1 << len) - 1);
    }
    if (len > 16) throw new Error('corrupt JPEG: bad Huffman code');
    this.cnt -= len;
    return t.values[code + t.valoffset[len]];
  }

  /** Drop buffered bits and step over a restart marker. */
  restart(): void {
    this.cnt = 0;
    this.buf = 0;
    this.atMarker = false;
    const d = this.data;
    while (this.pos + 1 < d.length && !(d[this.pos] === 0xff && d[this.pos + 1] >= 0xd0 && d[this.pos + 1] <= 0xd7)) this.pos++;
    if (this.pos + 1 < d.length) this.pos += 2;
  }

  /** Byte offset just after the scan's entropy-coded data. */
  endOfScan(): number {
    const d = this.data;
    let p = this.pos;
    while (p + 1 < d.length && !(d[p] === 0xff && d[p + 1] !== 0x00 && !(d[p + 1] >= 0xd0 && d[p + 1] <= 0xd7))) p++;
    return p;
  }
}

function extend(v: number, s: number): number {
  return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
}

function decodeBlock(r: BitReader, c: Component, offset: number): void {
  const out = c.coefs;
  const s = r.decode(c.dcTable!);
  const diff = s ? extend(r.bits(s), s) : 0;
  c.dcPred += diff;
  out[offset] = c.dcPred;
  const ac = c.acTable!;
  for (let k = 1; k < 64; ) {
    const rs = r.decode(ac);
    const run = rs >> 4;
    const size = rs & 15;
    if (size === 0) {
      if (run !== 15) break;
      k += 16;
      continue;
    }
    k += run;
    if (k > 63) break;
    out[offset + NATURAL[k]] = extend(r.bits(size), size);
    k++;
  }
}

// jidctint.c constants, CONST_BITS 13, PASS1_BITS 2.
const FIX_0_298631336 = 2446;
const FIX_0_390180644 = 3196;
const FIX_0_541196100 = 4433;
const FIX_0_765366865 = 6270;
const FIX_0_899976223 = 7373;
const FIX_1_175875602 = 9633;
const FIX_1_501321110 = 12299;
const FIX_1_847759065 = 15137;
const FIX_1_961570560 = 16069;
const FIX_2_053119869 = 16819;
const FIX_2_562915447 = 20995;
const FIX_3_072711026 = 25172;

/** Post-IDCT range limit of libjpeg: the value is masked to 10 bits, then clamped around the 128 offset. */
function idctLimit(x: number): number {
  const i = x & 1023;
  return i < 128 ? i + 128 : i < 512 ? 255 : i < 896 ? 0 : i - 896;
}

/**
 * jpeg_idct_islow. Intermediate values stay well inside 32 bits for 8-bit
 * samples, so int32 arithmetic matches the C code.
 */
function idctBlock(coefs: Int32Array, off: number, q: Int32Array, ws: Int32Array, out: Uint8Array, outOff: number, stride: number): void {
  for (let col = 0; col < 8; col++) {
    const c0 = coefs[off + col], c1 = coefs[off + 8 + col], c2 = coefs[off + 16 + col], c3 = coefs[off + 24 + col];
    const c4 = coefs[off + 32 + col], c5 = coefs[off + 40 + col], c6 = coefs[off + 48 + col], c7 = coefs[off + 56 + col];
    if (c1 === 0 && c2 === 0 && c3 === 0 && c4 === 0 && c5 === 0 && c6 === 0 && c7 === 0) {
      const dc = (c0 * q[col]) << 2;
      for (let r = 0; r < 8; r++) ws[r * 8 + col] = dc;
      continue;
    }
    let z2 = c2 * q[16 + col];
    let z3 = c6 * q[48 + col];
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 - z3 * FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = c0 * q[col];
    z3 = c4 * q[32 + col];
    let tmp0 = (z2 + z3) << 13;
    let tmp1 = (z2 - z3) << 13;
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;

    tmp0 = c7 * q[56 + col];
    tmp1 = c5 * q[40 + col];
    tmp2 = c3 * q[24 + col];
    tmp3 = c1 * q[8 + col];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    ws[col] = (tmp10 + tmp3 + 1024) >> 11;
    ws[56 + col] = (tmp10 - tmp3 + 1024) >> 11;
    ws[8 + col] = (tmp11 + tmp2 + 1024) >> 11;
    ws[48 + col] = (tmp11 - tmp2 + 1024) >> 11;
    ws[16 + col] = (tmp12 + tmp1 + 1024) >> 11;
    ws[40 + col] = (tmp12 - tmp1 + 1024) >> 11;
    ws[24 + col] = (tmp13 + tmp0 + 1024) >> 11;
    ws[32 + col] = (tmp13 - tmp0 + 1024) >> 11;
  }
  for (let row = 0; row < 8; row++) {
    const w = row * 8;
    const o = outOff + row * stride;
    if (ws[w + 1] === 0 && ws[w + 2] === 0 && ws[w + 3] === 0 && ws[w + 4] === 0 && ws[w + 5] === 0 && ws[w + 6] === 0 && ws[w + 7] === 0) {
      const v = idctLimit((ws[w] + 16) >> 5);
      for (let i = 0; i < 8; i++) out[o + i] = v;
      continue;
    }
    let z2 = ws[w + 2];
    let z3 = ws[w + 6];
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 - z3 * FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    let tmp0 = (ws[w] + ws[w + 4]) << 13;
    let tmp1 = (ws[w] - ws[w + 4]) << 13;
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
    tmp0 = ws[w + 7];
    tmp1 = ws[w + 5];
    tmp2 = ws[w + 3];
    tmp3 = ws[w + 1];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    out[o] = idctLimit((tmp10 + tmp3 + 131072) >> 18);
    out[o + 7] = idctLimit((tmp10 - tmp3 + 131072) >> 18);
    out[o + 1] = idctLimit((tmp11 + tmp2 + 131072) >> 18);
    out[o + 6] = idctLimit((tmp11 - tmp2 + 131072) >> 18);
    out[o + 2] = idctLimit((tmp12 + tmp1 + 131072) >> 18);
    out[o + 5] = idctLimit((tmp12 - tmp1 + 131072) >> 18);
    out[o + 3] = idctLimit((tmp13 + tmp0 + 131072) >> 18);
    out[o + 4] = idctLimit((tmp13 - tmp0 + 131072) >> 18);
  }
}

/** Sample plane of one component at its own (downsampled) resolution, padded to whole blocks. */
function componentPlane(c: Component, q: Int32Array): Uint8Array {
  const stride = c.bw * 8;
  const plane = new Uint8Array(stride * c.bh * 8);
  const ws = new Int32Array(64);
  for (let by = 0; by < c.bh; by++) {
    for (let bx = 0; bx < c.bw; bx++) {
      idctBlock(c.coefs, (by * c.bw + bx) * 64, q, ws, plane, by * 8 * stride + bx * 8, stride);
    }
  }
  return plane;
}

/** jdsample.c h2v2_fancy_upsample, with libjpeg's edge rows (first and last rows repeated). */
function upsampleH2V2(src: Uint8Array, stride: number, dw: number, dh: number, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const row = new Uint8Array(2 * dw);
  for (let oy = 0; oy < outH; oy++) {
    const inRow = oy >> 1;
    const near = Math.min(inRow, dh - 1);
    const far = oy & 1 ? Math.min(inRow + 1, dh - 1) : Math.max(inRow - 1, 0);
    const p0 = near * stride;
    const p1 = far * stride;
    let o = 0;
    let thiscolsum = src[p0] * 3 + src[p1];
    let nextcolsum = src[p0 + 1] * 3 + src[p1 + 1];
    row[o++] = (thiscolsum * 4 + 8) >> 4;
    row[o++] = (thiscolsum * 3 + nextcolsum + 7) >> 4;
    let lastcolsum = thiscolsum;
    thiscolsum = nextcolsum;
    for (let x = 2; x < dw; x++) {
      nextcolsum = src[p0 + x] * 3 + src[p1 + x];
      row[o++] = (thiscolsum * 3 + lastcolsum + 8) >> 4;
      row[o++] = (thiscolsum * 3 + nextcolsum + 7) >> 4;
      lastcolsum = thiscolsum;
      thiscolsum = nextcolsum;
    }
    row[o++] = (thiscolsum * 3 + lastcolsum + 8) >> 4;
    row[o++] = (thiscolsum * 4 + 7) >> 4;
    out.set(row.subarray(0, outW), oy * outW);
  }
  return out;
}

/** jdsample.c h2v1_fancy_upsample. */
function upsampleH2V1(src: Uint8Array, stride: number, dw: number, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const row = new Uint8Array(2 * dw);
  for (let y = 0; y < outH; y++) {
    const p = y * stride;
    let o = 0;
    let v = src[p];
    row[o++] = v;
    row[o++] = (v * 3 + src[p + 1] + 2) >> 2;
    for (let x = 1; x < dw - 1; x++) {
      v = src[p + x] * 3;
      row[o++] = (v + src[p + x - 1] + 1) >> 2;
      row[o++] = (v + src[p + x + 1] + 2) >> 2;
    }
    v = src[p + dw - 1];
    row[o++] = (v * 3 + src[p + dw - 2] + 1) >> 2;
    row[o++] = v;
    out.set(row.subarray(0, outW), y * outW);
  }
  return out;
}

function crop(src: Uint8Array, stride: number, w: number, h: number): Uint8Array {
  if (stride === w) return src.subarray(0, w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * stride, y * stride + w), y * w);
  return out;
}

// jdcolor.c tables, SCALEBITS 16.
const CR_R = new Int32Array(256);
const CB_B = new Int32Array(256);
const CR_G = new Int32Array(256);
const CB_G = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  const x = i - 128;
  CR_R[i] = (Math.round(1.402 * 65536) * x + 32768) >> 16;
  CB_B[i] = (Math.round(1.772 * 65536) * x + 32768) >> 16;
  CR_G[i] = -Math.round(0.71414 * 65536) * x;
  CB_G[i] = -Math.round(0.34414 * 65536) * x + 32768;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function decodeJpeg(data: Uint8Array): RgbaImage {
  if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('not a JPEG');
  const qt: Int32Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0, height = 0, hmax = 1, vmax = 1, mcusX = 0, mcusY = 0;
  let restartInterval = 0;
  let adobeTransform: number | null = null;
  let sawFrame = false;
  let pos = 2;
  const u16 = (p: number) => (data[p] << 8) | data[p + 1];

  while (pos < data.length) {
    if (data[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = data[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    pos += 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xd9) break;
    const len = u16(pos);
    const seg = pos + 2;
    const end = pos + len;
    switch (marker) {
      case 0xdb: {
        let p = seg;
        while (p < end) {
          const pq = data[p] >> 4, tq = data[p] & 15;
          p++;
          const t = new Int32Array(64);
          for (let k = 0; k < 64; k++) {
            t[NATURAL[k]] = pq ? u16(p + 2 * k) : data[p + k];
          }
          p += pq ? 128 : 64;
          qt[tq] = t;
        }
        break;
      }
      case 0xc4: {
        let p = seg;
        while (p < end) {
          const tc = data[p] >> 4, th = data[p] & 15;
          const counts = data.subarray(p + 1, p + 17);
          let n = 0;
          for (let i = 0; i < 16; i++) n += counts[i];
          const values = data.slice(p + 17, p + 17 + n);
          (tc === 0 ? dcTables : acTables)[th] = buildHuffman(counts, values);
          p += 17 + n;
        }
        break;
      }
      case 0xc0:
      case 0xc1: {
        if (data[seg] !== 8) throw new JpegUnsupported(`${data[seg]}-bit samples`);
        height = u16(seg + 1);
        width = u16(seg + 3);
        const n = data[seg + 5];
        comps = [];
        for (let i = 0; i < n; i++) {
          const b = seg + 6 + i * 3;
          comps.push({ id: data[b], h: data[b + 1] >> 4, v: data[b + 1] & 15, tq: data[b + 2], bw: 0, bh: 0, dw: 0, dh: 0, coefs: new Int32Array(0), dcPred: 0, dcTable: null, acTable: null });
        }
        hmax = Math.max(...comps.map((c) => c.h));
        vmax = Math.max(...comps.map((c) => c.v));
        mcusX = Math.ceil(width / (8 * hmax));
        mcusY = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          c.bw = mcusX * c.h;
          c.bh = mcusY * c.v;
          c.dw = Math.ceil((width * c.h) / hmax);
          c.dh = Math.ceil((height * c.v) / vmax);
          c.coefs = new Int32Array(c.bw * c.bh * 64);
        }
        sawFrame = true;
        break;
      }
      case 0xc2:
      case 0xc3:
      case 0xc5:
      case 0xc6:
      case 0xc7:
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        throw new JpegUnsupported(`SOF${marker - 0xc0}`);
      case 0xdd:
        restartInterval = u16(seg);
        break;
      case 0xee:
        if (data[seg] === 0x41 && data[seg + 1] === 0x64 && data[seg + 2] === 0x6f && data[seg + 3] === 0x62 && data[seg + 4] === 0x65) {
          adobeTransform = data[seg + 11];
        }
        break;
      case 0xda: {
        if (!sawFrame) throw new Error('corrupt JPEG: scan before frame');
        const ns = data[seg];
        const scan: Component[] = [];
        for (let i = 0; i < ns; i++) {
          const id = data[seg + 1 + i * 2];
          const tables = data[seg + 2 + i * 2];
          const c = comps.find((x) => x.id === id);
          if (!c) throw new Error('corrupt JPEG: unknown component in scan');
          c.dcTable = dcTables[tables >> 4];
          c.acTable = acTables[tables & 15];
          c.dcPred = 0;
          scan.push(c);
        }
        const r = new BitReader(data, end);
        let left = restartInterval;
        const tick = () => {
          if (!restartInterval) return;
          if (left === 0) {
            r.restart();
            for (const c of scan) c.dcPred = 0;
            left = restartInterval;
          }
          left--;
        };
        if (ns === 1) {
          const c = scan[0];
          const bw = Math.ceil(c.dw / 8), bh = Math.ceil(c.dh / 8);
          for (let by = 0; by < bh; by++) {
            for (let bx = 0; bx < bw; bx++) {
              tick();
              decodeBlock(r, c, (by * c.bw + bx) * 64);
            }
          }
        } else {
          for (let my = 0; my < mcusY; my++) {
            for (let mx = 0; mx < mcusX; mx++) {
              tick();
              for (const c of scan) {
                for (let v = 0; v < c.v; v++) {
                  for (let h = 0; h < c.h; h++) {
                    decodeBlock(r, c, ((my * c.v + v) * c.bw + mx * c.h + h) * 64);
                  }
                }
              }
            }
          }
        }
        pos = r.endOfScan();
        continue;
      }
      default:
        break;
    }
    pos = end;
  }
  if (!sawFrame) throw new Error('corrupt JPEG: no frame');

  const planes = comps.map((c) => {
    const q = qt[c.tq];
    if (!q) throw new Error('corrupt JPEG: missing quantisation table');
    const plane = componentPlane(c, q);
    const stride = c.bw * 8;
    if (c.h === hmax && c.v === vmax) return crop(plane, stride, width, height);
    if (hmax === 2 * c.h && vmax === 2 * c.v && c.dw > 2) return upsampleH2V2(plane, stride, c.dw, c.dh, width, height);
    if (hmax === 2 * c.h && vmax === c.v && c.dw > 2) return upsampleH2V1(plane, stride, c.dw, width, height);
    throw new JpegUnsupported(`sampling ${c.h}x${c.v} of ${hmax}x${vmax}`);
  });

  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);
  if (comps.length === 1) {
    const y = planes[0];
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = y[i];
      rgba[o + 3] = 255;
    }
  } else if (comps.length === 3) {
    const [p0, p1, p2] = planes;
    if (adobeTransform === 0) {
      for (let i = 0, o = 0; i < n; i++, o += 4) {
        rgba[o] = p0[i];
        rgba[o + 1] = p1[i];
        rgba[o + 2] = p2[i];
        rgba[o + 3] = 255;
      }
    } else {
      for (let i = 0, o = 0; i < n; i++, o += 4) {
        const y = p0[i], cb = p1[i], cr = p2[i];
        rgba[o] = clamp255(y + CR_R[cr]);
        rgba[o + 1] = clamp255(y + ((CB_G[cb] + CR_G[cr]) >> 16));
        rgba[o + 2] = clamp255(y + CB_B[cb]);
        rgba[o + 3] = 255;
      }
    }
  } else {
    throw new JpegUnsupported(`${comps.length} components`);
  }
  return { width, height, rgba };
}
