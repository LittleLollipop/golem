/**
 * AxolotlClient — GraphStore implementation backed by the axolotl sidecar.
 *
 * The sidecar owns the real axolotl_rs graph files (one per instance). This
 * client is a thin HTTP wrapper. No memory ever touches the filesystem as a
 * file/markdown log — only the sidecar's axolotl .axeb files do (dec_memory_axolotl_only).
 */

import type { GraphStore, QuerySpec } from "./graph-store.js";
import type {
  GraphNode,
  GraphEdge,
  GraphStats,
  ConsolidationReport,
  InstanceId,
  InstanceMeta,
} from "../types.js";

const DEFAULT_BASE = process.env.FAKEREN_SIDECAR_URL ?? "http://127.0.0.1:8741";

export class AxolotlClient implements GraphStore {
  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`axolotl sidecar ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`axolotl sidecar GET ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`axolotl sidecar PUT ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  async ensureInstance(id: InstanceId): Promise<void> {
    await this.post<void>(`/instance/create`, { id });
  }

  async addNode(n: GraphNode): Promise<void> {
    await this.post<void>(`/${encodeURIComponent(n.instanceId)}/node`, n);
  }

  async addEdge(e: GraphEdge): Promise<void> {
    await this.post<void>(`/${encodeURIComponent(e.instanceId)}/edge`, e);
  }

  async query(spec: QuerySpec): Promise<GraphNode[]> {
    return this.post<GraphNode[]>(`/${encodeURIComponent(spec.instanceId)}/query`, spec);
  }

  async recall(spec: QuerySpec): Promise<GraphNode[]> {
    return this.post<GraphNode[]>(`/${encodeURIComponent(spec.instanceId)}/recall`, spec);
  }

  async queryCrossDomain(instanceId: InstanceId, limit = 200): Promise<GraphEdge[]> {
    return this.post<GraphEdge[]>(`/${encodeURIComponent(instanceId)}/crossdomain`, { limit });
  }

  async consolidate(instanceId: InstanceId, budget: number): Promise<ConsolidationReport> {
    return this.post<ConsolidationReport>(`/${encodeURIComponent(instanceId)}/consolidate`, {
      budget,
    });
  }

  async stats(instanceId: InstanceId): Promise<GraphStats> {
    return this.get<GraphStats>(`/${encodeURIComponent(instanceId)}/stats`);
  }

  async listInstances(): Promise<InstanceId[]> {
    return this.get<InstanceId[]>(`/instances`);
  }

  async getMeta(id: InstanceId): Promise<InstanceMeta | null> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(id)}/meta`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`axolotl sidecar GET /${id}/meta -> ${res.status}`);
    return (await res.json()) as InstanceMeta;
  }

  async setMeta(id: InstanceId, meta: InstanceMeta): Promise<void> {
    await this.post<void>(`/${encodeURIComponent(id)}/meta`, meta);
  }

  async listMeta(): Promise<InstanceMeta[]> {
    return this.get<InstanceMeta[]>(`/instances/meta`);
  }

  async bindSession(sessionId: string, instanceId: InstanceId): Promise<void> {
    await this.post<void>(`/session/bind`, { sessionId, instanceId });
  }

  async resolveSession(sessionId: string): Promise<InstanceId | null> {
    const res = await this.post<{ instanceId: InstanceId | null }>(`/session/resolve`, {
      sessionId,
    });
    return res.instanceId;
  }

  async getDefaultInstance(): Promise<InstanceId | null> {
    const res = await this.get<{ instanceId: InstanceId | null }>(`/config/default`);
    return res.instanceId ?? null;
  }

  async setDefaultInstance(id: InstanceId): Promise<void> {
    await this.put<void>(`/config/default`, { instanceId: id });
  }
}
