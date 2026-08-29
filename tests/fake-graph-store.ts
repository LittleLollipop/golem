/**
 * FakeGraphStore — in-memory GraphStore for unit tests.
 * Implements the real GraphStore contract so writer/reader/consolidator/registry
 * can be exercised without the axolotl sidecar.
 */
import type { GraphStore, QuerySpec } from "../src/memory/graph-store.js";
import type {
  GraphNode,
  GraphEdge,
  GraphStats,
  ConsolidationReport,
  InstanceId,
  InstanceMeta,
} from "../src/types.js";

export class FakeGraphStore implements GraphStore {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private instances = new Set<InstanceId>();
  private metas = new Map<InstanceId, InstanceMeta>();
  private sessions = new Map<string, InstanceId>();

  /** captures the last consolidate() call for assertions. */
  lastConsolidate: { instanceId: InstanceId; budget: number } | null = null;
  /** captures every recall() spec for assertions. */
  recallCalls: QuerySpec[] = [];

  get allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }
  get allEdges(): GraphEdge[] {
    return [...this.edges.values()];
  }
  hasInstance(id: InstanceId): boolean {
    return this.instances.has(id);
  }

  async ensureInstance(id: InstanceId): Promise<void> {
    this.instances.add(id);
    if (!this.metas.has(id)) {
      this.metas.set(id, { id, name: id, createdAt: Date.now(), turns: 0 });
    }
  }
  async addNode(n: GraphNode): Promise<void> {
    this.nodes.set(n.id, n);
  }
  async addEdge(e: GraphEdge): Promise<void> {
    this.edges.set(`${e.from}->${e.to}:${e.kind}`, e);
  }
  async query(spec: QuerySpec): Promise<GraphNode[]> {
    return this.allNodes.filter(
      (n) => n.instanceId === spec.instanceId && (!spec.type || n.type === spec.type),
    );
  }
  async recall(spec: QuerySpec): Promise<GraphNode[]> {
    this.recallCalls.push(spec);
    const kws = spec.keywords ?? [];
    const matched = this.allNodes.filter(
      (n) =>
        n.instanceId === spec.instanceId &&
        kws.some((k) => n.label.toLowerCase().includes(k.toLowerCase())),
    );
    const byValence = spec.minAbsValence
      ? matched.filter((n) => Math.abs(n.valence) >= spec.minAbsValence!)
      : matched;
    return byValence.slice(0, spec.limit ?? 20);
  }
  async queryCrossDomain(instanceId: InstanceId, limit = 200): Promise<GraphEdge[]> {
    return this.allEdges
      .filter((e) => e.instanceId === instanceId && e.kind === "crossdomain_weak")
      .slice(0, limit);
  }
  async neighbors(instanceId: InstanceId, nodeId: string): Promise<GraphNode[]> {
    const out: GraphNode[] = [];
    const seen = new Set<string>();
    for (const e of this.allEdges) {
      if (e.instanceId !== instanceId) continue;
      let other: string | undefined;
      if (e.from === nodeId) other = e.to;
      else if (e.to === nodeId) other = e.from;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      const n = this.nodes.get(other);
      if (n) out.push(n);
    }
    return out;
  }
  async consolidate(instanceId: InstanceId, budget: number): Promise<ConsolidationReport> {
    this.lastConsolidate = { instanceId, budget };
    return {
      instanceId,
      reviewed: 0,
      decayed: 0,
      merged: [],
      grownMeta: [],
      kept: 0,
    };
  }
  async stats(instanceId: InstanceId): Promise<GraphStats> {
    const ns = this.allNodes.filter((n) => n.instanceId === instanceId);
    const es = this.allEdges.filter((e) => e.instanceId === instanceId);
    return {
      instanceId,
      nodes: ns.length,
      edges: es.length,
      decayed: ns.filter((n) => n.decayed).length,
    };
  }
  async listInstances(): Promise<InstanceId[]> {
    return [...this.instances];
  }

  async getMeta(id: InstanceId): Promise<InstanceMeta | null> {
    return this.metas.get(id) ?? null;
  }
  async setMeta(id: InstanceId, meta: InstanceMeta): Promise<void> {
    this.metas.set(id, meta);
  }
  async listMeta(): Promise<InstanceMeta[]> {
    return [...this.metas.values()];
  }
  async bindSession(sessionId: string, instanceId: InstanceId): Promise<void> {
    this.sessions.set(sessionId, instanceId);
  }
  async resolveSession(sessionId: string): Promise<InstanceId | null> {
    return this.sessions.get(sessionId) ?? null;
  }
}
