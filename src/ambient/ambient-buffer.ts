/**
 * AmbientBuffer — the L0 drift seed pool's physical substrate (req_sensor_camera_mic
 * / req_ambient_decay_stream). Ambient is a STREAM, not a library: samples enter
 * here, age out by TTL + max-window, and are SOFT-DECAYED so stale ambience stops
 * weighting on the present ("yesterday's ambience must not weigh on today").
 */

import type { AmbientSample } from "./types.js";

export interface BufferedAmbient {
  sample: AmbientSample;
  observationText: string;
  /** when this sample entered the buffer */
  at: number;
}

const DEFAULT_MIN_WEIGHT = 0.15;

export class AmbientBuffer {
  private items: BufferedAmbient[] = [];

  constructor(
    private readonly maxItems = 64,
    private readonly ttlMs = 24 * 3600 * 1000,
    private readonly halfLifeMs = 8 * 3600 * 1000,
  ) {}

  push(b: BufferedAmbient): void {
    this.items.push(b);
    this.evict();
  }

  /** Drop expired (TTL) then trim to the most-recent maxItems window. */
  private evict(): void {
    const now = Date.now();
    if (this.ttlMs > 0) {
      this.items = this.items.filter((i) => now - i.at <= this.ttlMs);
    }
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(this.items.length - this.maxItems);
    }
  }

  /** Exponential freshness weight in [0,1]; 1 when just captured. */
  private weightOf(item: BufferedAmbient, now: number): number {
    const age = now - item.at;
    if (age <= 0) return 1;
    return Math.exp(-age / this.halfLifeMs);
  }

  /**
   * Seed candidates for the L0 drift pool: freshest first, stale (decayed)
   * samples excluded by minWeight. This is the req_ambient_decay_stream
   * mechanism — an old ambient sample is never injected as a fresh seed.
   */
  seedCandidates(limit = 8, minWeight = DEFAULT_MIN_WEIGHT): BufferedAmbient[] {
    const now = Date.now();
    return this.items
      .map((i) => ({ item: i, w: this.weightOf(i, now) }))
      .filter((x) => x.w >= minWeight)
      .sort((a, b) => b.w - a.w)
      .slice(0, limit)
      .map((x) => x.item);
  }

  /** Observability: how many samples are still "alive" vs decayed out. */
  decayStats(): { total: number; fresh: number; decayedOut: number } {
    const now = Date.now();
    let fresh = 0;
    for (const i of this.items) if (this.weightOf(i, now) >= DEFAULT_MIN_WEIGHT) fresh++;
    return { total: this.items.length, fresh, decayedOut: this.items.length - fresh };
  }

  recent(limit = 8): BufferedAmbient[] {
    return this.items.slice(-limit);
  }

  all(): BufferedAmbient[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
