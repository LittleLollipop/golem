/**
 * AmbientBuffer — the L0 drift seed pool's physical substrate (req_sensor_camera_mic
 * / req_ambient_decay_stream). Ambient is a STREAM, not a library: samples enter
 * here and age out by TTL + max-window. #46 adds decay weighting on top.
 */

import type { AmbientSample } from "./types.js";

export interface BufferedAmbient {
  sample: AmbientSample;
  observationText: string;
  /** when this sample entered the buffer */
  at: number;
}

export class AmbientBuffer {
  private items: BufferedAmbient[] = [];

  constructor(
    private readonly maxItems = 64,
    private readonly ttlMs = 24 * 3600 * 1000,
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

  /** Most recent `limit` buffered samples, oldest→newest. */
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
