/**
 * PersonaSeed — seeds an instance's `personaExt` into the axolotl graph, wired
 * to a stable `persona-identity` anchor node (docs/persona-layering.md §4).
 *
 *  - The anchor node is the in-graph identity hub; it is NOT a recall target
 *    for persona details (it carries no red-line text — red lines live only in
 *    `personaCore`, which is never written to the graph).
 *  - ext facts are seeded via MemoryWriter.writePersonaExt, reusing the exact
 *    extractor seam used for dialogue (no second extraction channel).
 *  - Idempotent: a per-process Set plus an anchor-node existence check prevent
 *    double-seeding across sessions.
 */

import type { GraphStore } from "./graph-store.js";
import { MemoryWriter } from "./writer.js";
import type { InstanceId } from "../types.js";
import { loadPersonaLayerConfig } from "../leak/config.js";

export class PersonaSeed {
  private readonly seeded = new Set<InstanceId>();

  constructor(
    private readonly store: GraphStore,
    private readonly writer: MemoryWriter,
  ) {}

  /** Idempotent seed. Safe to call every pre-step; only seeds once per instance. */
  async ensureSeeded(instanceId: InstanceId, ext?: string): Promise<void> {
    const cfg = loadPersonaLayerConfig();
    if (!cfg.enabled || !ext) return;
    if (this.seeded.has(instanceId)) return;

    // 幂等判断：图中已有 anchor 节点则视为已 seed（兼容迁移场景）。
    const existing = await this.store.query({
      instanceId,
      props: { kind: "persona-anchor" },
    });
    if (existing.length > 0) {
      this.seeded.add(instanceId);
      return;
    }

    // 1. 写 anchor 节点（常驻锚，不含红线文本）。
    await this.store.addNode({
      id: cfg.anchorId,
      type: "Entity",
      label: cfg.anchorId,
      instanceId,
      props: { kind: "persona-anchor" },
      valence: 0,
      valenceSelf: true,
      weight: 1.0,
      decayed: false,
      timestamp: Date.now(),
      provenanceId: "persona-seed",
    });

    // 2. 复用 MemoryWriter 抽取管线把 ext 写图，并连到 anchor。
    await this.writer.writePersonaExt(ext, instanceId, cfg.anchorId);
    this.seeded.add(instanceId);
  }
}
