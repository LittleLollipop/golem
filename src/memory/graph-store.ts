/**
 * GraphStore — the memory substrate contract (维度 H).
 *
 * All memory access (read & write) for a fakeren instance goes through this
 * interface. The only production implementation talks to the axolotl sidecar
 * (axolotl_rs), per the decision `dec_memory_axolotl_only`: NO file/markdown
 * memory or logs — axolotl is the single source of truth, and it is per-instance
 * namespaced (维度 I).
 */

import type {
  GraphNode,
  GraphEdge,
  GraphStats,
  ConsolidationReport,
  InstanceId,
  NodeType,
} from "../types.js";

export interface QuerySpec {
  instanceId: InstanceId;
  type?: NodeType;
  props?: Record<string, unknown>;
  keywords?: string[];
  /** recall by AI-self valence magnitude (drift/emotion coupling). */
  minAbsValence?: number;
  limit?: number;
}

export interface GraphStore {
  /** Ensure an empty graph exists for this instance (idempotent). */
  ensureInstance(id: InstanceId): Promise<void>;

  addNode(n: GraphNode): Promise<void>;
  addEdge(e: GraphEdge): Promise<void>;

  /** General query (by type / props / keyword). */
  query(spec: QuerySpec): Promise<GraphNode[]>;

  /** Recall by keyword + optional AI-self valence (req_memory_recall_targeted). */
  recall(spec: QuerySpec): Promise<GraphNode[]>;

  /** Cross-domain weak edges — the physical载体 of L0 drift seeds (C2). */
  queryCrossDomain(instanceId: InstanceId, limit?: number): Promise<GraphEdge[]>;

  /** Plan B decay + conservative recursive growth (req_memory_consolidation). */
  consolidate(instanceId: InstanceId, budget: number): Promise<ConsolidationReport>;

  stats(instanceId: InstanceId): Promise<GraphStats>;

  /** List instance ids known to the backing store. */
  listInstances(): Promise<InstanceId[]>;
}
