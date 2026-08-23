/**
 * MemoryReader — read-side access for the channels.
 *
 * `recall` is goal-directed memory retrieval (req_memory_recall_targeted);
 * `crossDomain` returns the cross-domain weak edges that are the physical
 * seeds of L0 drift (C2 — distinct from the recall channel). Both are per-instance.
 */

import type { GraphStore } from "./graph-store.js";
import type { GraphNode, GraphEdge, InstanceId } from "../types.js";

export class MemoryReader {
  constructor(private readonly store: GraphStore) {}

  async recall(
    instanceId: InstanceId,
    keywords: string[],
    minAbsValence?: number,
    limit = 20,
  ): Promise<GraphNode[]> {
    return this.store.recall({ instanceId, keywords, minAbsValence, limit });
  }

  /** Cross-domain weak edges = L0 drift seed pool (C2 separation). */
  async crossDomain(instanceId: InstanceId, limit = 200): Promise<GraphEdge[]> {
    return this.store.queryCrossDomain(instanceId, limit);
  }
}
