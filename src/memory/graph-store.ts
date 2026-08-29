/**
 * GraphStore — the memory substrate contract (维度 H).
 *
 * All memory access (read & write) for a golem instance goes through this
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
  InstanceMeta,
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

  // ── Instance metadata + session binding (维度 I) ──────────────────────
  // These live in the same substrate as the memory graph: the substrate is
  // golem's single source of truth, not dsh's storageDomain.

  /** Read one instance's metadata (name/createdAt/turns), or null if absent. */
  getMeta(id: InstanceId): Promise<InstanceMeta | null>;
  /** Upsert one instance's metadata. */
  setMeta(id: InstanceId, meta: InstanceMeta): Promise<void>;
  /** List metadata for every known instance. */
  listMeta(): Promise<InstanceMeta[]>;

  /** Bind a session to exactly one instance (req_iso_no_mid_switch). */
  bindSession(sessionId: string, instanceId: InstanceId): Promise<void>;
  /** Resolve the instance a session is bound to, or null. */
  resolveSession(sessionId: string): Promise<InstanceId | null>;

  /** Persisted default instance id (req_iso_session_select: 默认上次使用的). */
  getDefaultInstance(): Promise<InstanceId | null>;
  /** Set the persisted default instance id. */
  setDefaultInstance(id: InstanceId): Promise<void>;

  /** Delete an instance entirely (meta + its memory graph). 404 (absent) is treated as gone. */
  deleteInstance(id: InstanceId): Promise<void>;
}
