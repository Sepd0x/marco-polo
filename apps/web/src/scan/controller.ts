import {
  captureLookup,
  DetectionMerger,
  estimatePlan,
  fallbackPart,
  lonLatToTile,
  metersPerPixelOfBitmap,
  MirrorChoice,
  NEIGHBOUR_OFFSETS,
  neighbourTile,
  partCentre,
  pointInRing,
  sampleTiles,
  splitPlanBySource,
  staticCaptureInfo,
  tileRequest,
  type ImageryProvider,
  type ImagerySetting,
  type MergerEvent,
  type PlanPart,
  type Ring,
  type ScanTile,
  type TileCoord,
  type TileRequest,
  type TraversalOrder,
} from '@marco-polo/core';
import { useStore, visibleRanked, type ArchiveSummary, type PartView, type TileOutcome } from '../state/store.js';
import { fragKey } from '../lib/fragKey.js';
import { formatArea } from '../lib/format.js';
import { ScanMachine, phaseOf, type ScanState } from './machine.js';
import { isAbort, TokenBucket } from './pacer.js';
import { fetchTile, type FetchFn, type TileBytes, type TileCache } from './tileSource.js';
import { pieceTiles, type WorkJob, type WorkResult } from './tileWork.js';
import { detectionId, newScanId } from './ids.js';
import { savedPart, type SavedScan } from './persist.js';
import { cutoffsInUse } from '../lib/score.js';

/** Probe tiles asked of a part's source before it is scanned (same as the CLI). */
export const PROBE_TILES = 5;

export interface Pool {
  readonly size: number;
  run(job: Omit<WorkJob, 'id'>, transfer?: Transferable[]): Promise<WorkResult>;
  dispose(): void;
}

export interface ScanRequest {
  area: Ring;
  setting: ImagerySetting;
  order: TraversalOrder;
  /** Requests per second asked for; each source also has its own ceiling. */
  ratePerSec: number;
  name?: string;
  threshold?: number;
}

export interface ControllerDeps {
  makePool: () => Pool;
  fetch: FetchFn;
  cache: TileCache | null;
  save?: (rec: SavedScan) => Promise<ArchiveSummary[]>;
  store?: typeof useStore;
  /** Halo the detector reads, px of a 256 px tile (a 512 px WMS bitmap gets twice that); 0 for v1. */
  halo?: number;
  detectorId?: string;
  /** Look up capture dates (one request per part). */
  dates?: boolean;
  scanId?: string;
}

/** Thrown inside the run loop once the scan is stopped or disposed. */
class ScanCancelled extends Error {
  constructor() {
    super('scan cancelled');
    this.name = 'ScanCancelled';
  }
}

interface PartRun {
  part: PlanPart;
  view: PartView;
  merger: DetectionMerger;
  /** Probe answers, reused so a probed tile is not requested twice. */
  probed: Map<string, TileBytes>;
  failed: ScanTile[];
  /** Thumbnails by fragment key, published once their fragment leads a detection. */
  blobs: Map<string, Blob>;
  /** XYZ halo: neighbour bytes still needed, with how many tiles still need them. */
  shared: Map<string, { bytes: Promise<TileBytes> | null; uses: number }>;
  /** Merger ids of this part's detections the store holds. */
  shown: Set<string>;
}

function viewOf(part: PlanPart, date: string | null, fellBackFrom: string | null): PartView {
  const p = part.provider;
  return {
    id: part.id,
    providerId: p.id,
    providerName: p.name,
    attribution: p.attribution,
    licence: p.licence,
    date,
    zoom: part.plan.zoom,
    nativeResM: p.nativeResM,
    tiles: part.plan.tiles,
    tilesDone: 0,
    tilesFailed: 0,
    tilesNoCoverage: 0,
    areaM2: part.areaM2,
    status: 'waiting',
    fellBackFrom,
  };
}

function tileAreaM2(tile: TileCoord): number {
  const side = metersPerPixelOfBitmap(tile, 256) * 256;
  return side * side;
}

/**
 * One scan, from the plan to the archive. A single state machine decides
 * every move; a token bucket paces every network request; results reach the
 * store only while this scan is the one the store shows.
 */
export class ScanController {
  readonly scanId: string;
  readonly machine = new ScanMachine();
  private readonly store: typeof useStore;
  private readonly halo: number;
  private readonly detectorId: string;
  private abort = new AbortController();
  private bucket: TokenBucket;
  /** Per provider with a mirror: which of its two servers goes first. */
  private readonly mirrors = new Map<string, MirrorChoice>();
  private pool: Pool | null = null;
  private runs: PartRun[] = [];
  private cellKeys = new WeakMap<PlanPart, Set<string>>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private resumeWaiters: (() => void)[] = [];
  private inflight = new Set<Promise<void>>();
  private slotsFree = 0;
  private slotWaiters: (() => void)[] = [];
  private unsubRate: (() => void) | null = null;
  private provider: ImageryProvider | null = null;
  private done = 0;
  private runStarted = 0;
  /** Settles when the run (or a retry) has finished, been stopped or disposed. */
  finished: Promise<void> = Promise.resolve();

  constructor(
    readonly request: ScanRequest,
    private readonly deps: ControllerDeps,
  ) {
    this.scanId = deps.scanId ?? newScanId();
    this.store = deps.store ?? useStore;
    this.halo = deps.halo ?? 0;
    this.detectorId = deps.detectorId ?? 'v1';
    this.bucket = new TokenBucket(Math.max(1, Math.min(10, request.ratePerSec)));
    this.machine.onChange((s) => this.onState(s));
  }

  get state(): ScanState {
    return this.machine.state;
  }

  /** Begin the scan. Refused (with a message in the store) when the area is over the limit. */
  start(): Promise<void> {
    if (!this.machine.send('start')) return this.finished;
    const estimate = estimatePlan(this.request.area, this.request.setting);
    if (estimate.level === 'block') {
      this.machine.send('dispose');
      this.store.getState().failScan(null, `This area needs about ${estimate.z19Tiles} tiles, above the limit of 10000. Draw a smaller area.`);
      return this.finished;
    }
    const split = splitPlanBySource(this.request.area, this.request.setting, this.request.order);
    this.runs = split.parts.map((part) => ({
      part,
      view: viewOf(part, null, null),
      merger: new DetectionMerger(),
      probed: new Map(),
      failed: [],
      blobs: new Map(),
      shared: new Map(),
      shown: new Set(),
    }));
    this.store.getState().beginScan(this.scanId, {
      parts: this.runs.map((r) => r.view),
      areaM2: split.parts.reduce((s, p) => s + p.areaM2, 0),
    });
    this.watchRate();
    this.finished = this.run(this.runs, false);
    return this.finished;
  }

  pause(): void {
    this.machine.send('pause');
  }

  resume(): void {
    this.machine.send('resume');
  }

  /** Stop early: the tiles done so far are kept, finalised and archived. */
  stop(): void {
    this.machine.send('stop');
  }

  /** Scan the failed tiles again, on the same parts and sources. */
  retryFailed(): Promise<void> {
    const runs = this.runs.filter((r) => r.failed.length > 0);
    if (runs.length === 0 || !this.machine.send('retry')) return this.finished;
    this.abort = new AbortController();
    this.bucket = new TokenBucket(this.bucket.perSecond);
    this.store.getState().retryStarted(this.scanId);
    this.finished = this.run(runs, true);
    return this.finished;
  }

  /** Forget this scan: abort everything, write nothing more, archive nothing. */
  dispose(): void {
    this.machine.send('dispose');
  }

  private onState(s: ScanState): void {
    const phase = phaseOf(s);
    if (s === 'paused') this.bucket.pause();
    if (s === 'running') {
      this.bucket.resume();
      const w = this.resumeWaiters;
      this.resumeWaiters = [];
      for (const fn of w) fn();
    }
    if (s === 'stopping' || s === 'disposed') {
      this.abort.abort(new ScanCancelled());
      this.bucket.close(new ScanCancelled());
      const w = this.resumeWaiters;
      this.resumeWaiters = [];
      for (const fn of w) fn();
      const sw = this.slotWaiters;
      this.slotWaiters = [];
      for (const fn of sw) fn();
    }
    if (s === 'disposed') this.teardown();
    if (phase && s !== 'done') this.store.getState().setScanPhase(this.scanId, phase);
  }

  private teardown(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.unsubRate?.();
    this.unsubRate = null;
    this.pool?.dispose();
    this.pool = null;
  }

  private alive(): boolean {
    return this.machine.state === 'running' || this.machine.state === 'paused';
  }

  /** Wait while paused; throw once stopped or disposed. */
  private async gate(): Promise<void> {
    while (this.machine.state === 'paused') {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
    }
    if (!this.alive()) throw new ScanCancelled();
  }

  private async slot(): Promise<void> {
    while (this.slotsFree <= 0) {
      await new Promise<void>((r) => this.slotWaiters.push(r));
      if (!this.alive()) throw new ScanCancelled();
    }
    this.slotsFree--;
  }

  private release(): void {
    this.slotsFree++;
    this.slotWaiters.shift()?.();
  }

  private watchRate(): void {
    this.unsubRate = this.store.subscribe(
      (s) => s.settings.ratePerSec,
      (rate) => {
        if (this.provider) this.bucket.setRate(this.rateFor(this.provider, rate));
      },
    );
  }

  /** Halo inside one WMS request, in px of the bitmap it asks for. */
  private wmsHalo(p: ImageryProvider): number {
    return p.kind === 'wms' ? (this.halo * p.requestPx) / 256 : 0;
  }

  private rateFor(p: ImageryProvider, asked = this.request.ratePerSec): number {
    return Math.max(1, Math.min(10, asked, p.rate.maxPerSec));
  }

  private async run(runs: PartRun[], retry: boolean): Promise<void> {
    this.pool = this.deps.makePool();
    this.slotsFree = this.pool.size + 2;
    this.done = 0;
    this.runStarted = Date.now();
    this.ticker = setInterval(() => this.store.getState().tickElapsed(this.scanId), 1000);
    try {
      for (const r of runs) {
        if (retry) {
          const tiles = r.failed;
          r.failed = [];
          await this.scanTiles(r, tiles);
        } else {
          await this.scanPart(r);
        }
      }
    } catch (err) {
      if (!(err instanceof ScanCancelled) && !isAbort(err)) {
        // An unexpected fault ends the scan like a stop, keeping what was found.
        this.machine.send('stop');
      }
    }
    await this.settleInflight();
    if (this.machine.state === 'disposed') return;
    await this.complete();
  }

  private async settleInflight(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private update(r: PartRun, patch: Partial<PartView>): void {
    r.view = { ...r.view, ...patch };
    this.store.getState().updatePart(this.scanId, r.view.id, patch);
  }

  private async scanPart(r: PartRun): Promise<void> {
    this.update(r, { status: 'probing' });
    await this.probe(r);
    this.provider = r.part.provider;
    this.bucket.setRate(this.rateFor(r.part.provider, this.store.getState().settings.ratePerSec));
    const date = await this.partDate(r.part);
    this.update(r, { date, status: 'scanning' });
    const pieces = r.part.plan.tiles.flatMap((t) => pieceTiles(t.tile, r.part.provider.requestPx, this.detectorId));
    r.merger = new DetectionMerger({}, pieces);
    r.shown.clear();
    this.prepareShared(r);
    await this.scanTiles(r, r.part.plan.tiles);
  }

  /**
   * Ask the part's source for a few tiles. If none holds imagery and the
   * choice is auto, the whole part moves to the next source of its chain.
   */
  private async probe(r: PartRun): Promise<void> {
    const fellFrom: string[] = [];
    for (;;) {
      const provider = r.part.provider;
      this.bucket.setRate(this.rateFor(provider));
      r.probed.clear();
      let withData = 0;
      let answered = 0;
      for (const t of sampleTiles(r.part, PROBE_TILES)) {
        await this.gate();
        const req = tileRequest(provider, t, this.wmsHalo(provider));
        try {
          const got = await this.get(provider, req);
          r.probed.set(req.url, got);
          answered++;
          if (got.status !== 200) continue;
          const res = await this.work(
            { scanId: this.scanId, providerId: provider.id, tile: t, tilePx: provider.requestPx, halo: req.halo, bytes: got.bytes.slice().buffer, probe: true },
          );
          if (!res.error && !res.noData) withData++;
        } catch (err) {
          if (err instanceof ScanCancelled || !this.alive()) throw new ScanCancelled();
          // No answer at all (offline, server down) says nothing about coverage.
        }
      }
      // Fall back only when the source answered and had no imagery; when it did
      // not answer, its tiles fail and can be retried on the same source.
      if (withData > 0 || answered === 0 || this.request.setting.mode === 'fixed') break;
      const next = fallbackPart(r.part, this.request.area, this.request.order);
      if (!next) break;
      fellFrom.push(provider.name);
      r.part = next;
      r.probed.clear();
      this.update(r, { ...viewOf(next, null, fellFrom[0]), status: 'probing' });
    }
  }

  private async partDate(part: PlanPart): Promise<string | null> {
    const centre = partCentre(part);
    const fixed = staticCaptureInfo(part.provider, centre);
    if (fixed) return fixed.date;
    if (this.deps.dates === false) return part.provider.date;
    const q = captureLookup(part.provider, centre, part.plan.zoom);
    if (!q) return part.provider.date;
    for (const url of q.urls) {
      await this.gate();
      try {
        const got = await fetchTile(url, { bucket: this.bucket, fetch: this.deps.fetch, signal: this.abort.signal, retries: 1, timeoutMs: 10_000 });
        if (got.status !== 200) continue;
        const info = q.parse(new TextDecoder().decode(got.bytes));
        if (info?.date) return info.date;
      } catch (err) {
        if (!this.alive()) throw new ScanCancelled();
        // Date not measured.
      }
    }
    return part.provider.date;
  }

  private get(provider: ImageryProvider, req: TileRequest): Promise<TileBytes> {
    let mirror = this.mirrors.get(provider.id);
    if (!mirror && req.mirrorUrl) this.mirrors.set(provider.id, (mirror = new MirrorChoice()));
    return fetchTile(req.url, {
      mirrorUrl: req.mirrorUrl,
      mirror,
      bucket: this.bucket,
      fetch: this.deps.fetch,
      cache: this.deps.cache,
      policy: provider.cachePolicy,
      signal: this.abort.signal,
    });
  }

  /**
   * XYZ halo: count how many tiles of the part need each tile (as centre or
   * as neighbour), so each is requested once and dropped after its last use.
   */
  private prepareShared(r: PartRun): void {
    r.shared.clear();
    if (this.halo === 0 || r.part.provider.kind !== 'xyz') return;
    const count = (t: TileCoord) => {
      const url = tileRequest(r.part.provider, t).url;
      const e = r.shared.get(url);
      if (e) e.uses++;
      else r.shared.set(url, { bytes: null, uses: 1 });
    };
    for (const { tile } of r.part.plan.tiles) {
      count(tile);
      for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
        const n = neighbourTile(tile, dx, dy);
        if (n) count(n);
      }
    }
  }

  /**
   * One job on the pool, given up when the scan is stopped or disposed: a
   * worker that never answers must not keep Stop from finishing.
   */
  private work(job: Omit<WorkJob, 'id'>): Promise<WorkResult> {
    const signal = this.abort.signal;
    if (signal.aborted) return Promise.reject(new ScanCancelled());
    return new Promise<WorkResult>((resolve, reject) => {
      const onAbort = () => reject(new ScanCancelled());
      signal.addEventListener('abort', onAbort, { once: true });
      this.pool!.run(job).then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          resolve(r);
        },
        (e) => {
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }

  /** A tile's bytes, through the shared halo table when the part has one. */
  private use(r: PartRun, req: TileRequest): Promise<TileBytes> {
    const e = r.shared.get(req.url);
    if (!e) return this.get(r.part.provider, req);
    e.bytes ??= this.get(r.part.provider, req);
    const bytes = e.bytes;
    if (--e.uses <= 0) r.shared.delete(req.url);
    return bytes;
  }

  private async neighbours(r: PartRun, tile: TileCoord): Promise<(ArrayBuffer | null)[] | undefined> {
    if (this.halo === 0 || r.part.provider.kind !== 'xyz') return undefined;
    const provider = r.part.provider;
    return Promise.all(
      NEIGHBOUR_OFFSETS.map(async ([dx, dy]) => {
        const n = neighbourTile(tile, dx, dy);
        if (!n) return null;
        try {
          const got = await this.use(r, tileRequest(provider, n));
          return got.status === 200 ? got.bytes.slice().buffer : null;
        } catch (err) {
          if (!this.alive()) throw new ScanCancelled();
          return null;
        }
      }),
    );
  }

  private async scanTiles(r: PartRun, tiles: ScanTile[]): Promise<void> {
    for (const t of tiles) {
      // A pause may land while waiting for a slot; then the slot goes back and the gate waits again.
      for (;;) {
        await this.gate();
        await this.slot();
        if (this.machine.state === 'running') break;
        this.release();
        if (!this.alive()) throw new ScanCancelled();
      }
      const p = this.processTile(r, t).finally(() => {
        this.release();
        this.inflight.delete(p);
      });
      this.inflight.add(p);
    }
    await this.settleInflight();
    if (!this.alive()) return;
    this.publish(r, r.merger.finalize());
    this.update(r, { status: 'done' });
  }

  private async processTile(r: PartRun, scanTile: ScanTile): Promise<void> {
    const store = this.store.getState();
    store.setCurrentTile(this.scanId, scanTile);
    const provider = r.part.provider;
    const tile = scanTile.tile;
    let outcome: TileOutcome = 'done';
    let events: MergerEvent[] = [];
    try {
      const req = tileRequest(provider, tile, this.wmsHalo(provider));
      const probed = r.probed.get(req.url);
      r.probed.delete(req.url);
      const got = probed ?? (await this.use(r, req));
      if (got.status === 404 || got.status === 204) {
        outcome = 'nocoverage';
      } else {
        const neighbours = await this.neighbours(r, tile);
        const res = await this.work(
          {
            scanId: this.scanId,
            providerId: provider.id,
            tile,
            tilePx: provider.requestPx,
            halo: provider.kind === 'wms' ? req.halo : this.halo,
            bytes: got.bytes.slice().buffer,
            neighbours,
            thumbs: true,
          },
        );
        if (res.error) throw new Error(res.error);
        if (res.noData) outcome = 'nocoverage';
        else {
          for (const th of res.thumbs) r.blobs.set(th.key, th.blob);
          for (const piece of res.pieces) events.push(...r.merger.addTileDetections(piece.tile, piece.detections));
        }
      }
    } catch (err) {
      if (err instanceof ScanCancelled || isAbort(err) || !this.alive()) return;
      outcome = 'failed';
      events = [];
    }
    if (!this.alive()) return;
    if (outcome === 'failed') r.failed.push(scanTile);
    this.done++;
    const remaining = this.remainingTiles();
    const elapsed = Date.now() - this.runStarted;
    const mapped = this.mapEvents(r, events);
    const added = mapped.find((e) => e.type === 'add');
    this.store.getState().tileFinished(this.scanId, {
      partId: r.view.id,
      tile: scanTile,
      outcome,
      events: mapped,
      thumbs: this.thumbsFor(r, mapped),
      scannedAreaM2: tileAreaM2(tile),
      etaMs: this.done > 3 ? (elapsed / this.done) * remaining : null,
      waterFiltered: this.runs.reduce((s, x) => s + x.merger.waterBodiesFiltered, 0),
      lastEvent: added && added.type === 'add' ? describe(added.detection) : null,
    });
  }

  private remainingTiles(): number {
    const s = this.store.getState().stats;
    return Math.max(0, s.tilesTotal - s.tilesDone - 1);
  }

  /**
   * True when a point belongs to this part: inside the drawn area and in one
   * of the part's own grid cells. Scan tiles stick out of the area, and the
   * tiles of two parts overlap along their border; a pool there would
   * otherwise be listed outside the area, or twice.
   */
  private owns(r: PartRun, lon: number, lat: number): boolean {
    if (!pointInRing(lon, lat, this.request.area)) return false;
    if (this.runs.length === 1) return true;
    let keys = this.cellKeys.get(r.part);
    if (!keys) this.cellKeys.set(r.part, (keys = new Set(r.part.cells.map((t) => `${t.x},${t.y}`))));
    const c = lonLatToTile(lon, lat, r.part.cellZoom);
    return keys.has(`${c.x},${c.y}`);
  }

  /** Merger events as the store sees them: ids for this scan and part, only pools this part owns. */
  private mapEvents(r: PartRun, events: MergerEvent[]): MergerEvent[] {
    const out: MergerEvent[] = [];
    for (const e of events) {
      if (e.type === 'remove') {
        if (r.shown.delete(e.id)) out.push({ type: 'remove', id: detectionId(this.scanId, r.view.id, e.id) });
        continue;
      }
      const local = e.detection.id;
      const id = detectionId(this.scanId, r.view.id, local);
      if (!this.owns(r, e.detection.center.lon, e.detection.center.lat)) {
        if (r.shown.delete(local)) out.push({ type: 'remove', id });
        continue;
      }
      const type = r.shown.has(local) ? 'update' : 'add';
      r.shown.add(local);
      out.push({ type, detection: { ...e.detection, id } });
    }
    return out;
  }

  /** Thumbnails only for fragments that lead a detection in these events. */
  private thumbsFor(r: PartRun, events: MergerEvent[]): Record<string, Blob> | undefined {
    let out: Record<string, Blob> | undefined;
    for (const e of events) {
      if (e.type === 'remove') continue;
      const key = fragKey(e.detection.primary.tile, e.detection.primary.bboxPx);
      const blob = r.blobs.get(key);
      if (blob) (out ??= {})[key] = blob;
    }
    return out;
  }

  private publish(r: PartRun, events: MergerEvent[]): void {
    const mapped = this.mapEvents(r, events);
    if (mapped.length > 0) this.store.getState().applyMergerEvents(this.scanId, mapped, this.thumbsFor(r, mapped));
  }

  private async complete(): Promise<void> {
    const stopped = this.machine.state === 'stopping';
    if (stopped) {
      // Tiles still waiting are not scanned; settle what is known.
      for (const r of this.runs) this.publish(r, r.merger.finalize());
    }
    for (const r of this.runs) r.blobs.clear();
    this.machine.send('finish');
    this.teardown();
    const s = this.store.getState();
    if (s.scanId !== this.scanId) return;
    s.finishScan(this.scanId, { stopped });
    if (!this.deps.save || !s.area) return;
    const after = this.store.getState();
    const name =
      this.request.name?.trim() ||
      after.scanName.trim() ||
      `Scan ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const archive = await this.deps.save({
      formatVersion: 2,
      id: this.scanId,
      savedAt: Date.now(),
      name,
      area: after.area ?? this.request.area,
      zoom: Math.max(...after.parts.map((p) => p.zoom), 0),
      stats: after.stats,
      detections: Object.values(after.detections),
      thumbs: after.thumbBlobs,
      parts: after.parts.map(savedPart),
      threshold: cutoffsInUse(after.settings, after.parts)[0],
      listed: visibleRanked(after).length,
    });
    if (this.store.getState().scanId === this.scanId) this.store.getState().setArchive(archive);
  }
}

function describe(d: { kind: string; areaM2: number; center: { lat: number; lon: number } }): string {
  const kind = d.kind === 'hot_tub' ? 'Hot tub' : 'Pool';
  return `${kind}, ${formatArea(d.areaM2)}, ${d.center.lat.toFixed(5)}, ${d.center.lon.toFixed(5)}`;
}
