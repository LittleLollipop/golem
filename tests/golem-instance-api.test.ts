/**
 * GolemInstanceApi 单测——核心「多假人实例」逻辑，不依赖 Typert 装饰器运行时。
 * 重点验证：list/create/getMeta 委托正确；setInstanceMeta 字段级合并
 * （不再整体覆盖、受保护字段不可篡改、未知实例抛错）；默认实例往返。
 */

import { describe, it, expect } from "vitest";
import { GolemInstanceApi } from "../src/golem-instance-api.js";
import { InstanceRegistry } from "../src/registry/instance-registry.js";
import type { GraphStore, QuerySpec, GraphNode, GraphEdge, GraphStats, ConsolidationReport, InstanceId, InstanceMeta } from "../src/types.js";

class MemStore implements GraphStore {
  private metas = new Map<string, InstanceMeta>();
  private defaultId: InstanceId | null = null;

  async ensureInstance(id: InstanceId): Promise<void> {
    if (!this.metas.has(id)) {
      this.metas.set(id, { id, name: id, createdAt: Date.now(), turns: 0 });
    }
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
  async listInstances(): Promise<InstanceId[]> {
    return [...this.metas.keys()];
  }
  async getDefaultInstance(): Promise<InstanceId | null> {
    return this.defaultId;
  }
  async setDefaultInstance(id: InstanceId): Promise<void> {
    this.defaultId = id;
  }
  async bindSession(): Promise<void> {}
  async resolveSession(): Promise<InstanceId | null> {
    return null;
  }
  // 图操作本服务不触碰，置为无副作用 stub。
  async addNode(): Promise<void> {}
  async addEdge(): Promise<void> {}
  async query(_s: QuerySpec): Promise<GraphNode[]> {
    return [];
  }
  async recall(_s: QuerySpec): Promise<GraphNode[]> {
    return [];
  }
  async queryCrossDomain(): Promise<GraphEdge[]> {
    return [];
  }
  async consolidate(): Promise<ConsolidationReport> {
    return { instanceId: "", reviewed: 0, decayed: 0, merged: [], grownMeta: [], kept: 0 };
  }
  async stats(): Promise<GraphStats> {
    return { instanceId: "", nodes: 0, edges: 0, decayed: 0 };
  }
}

function makeApi() {
  const store = new MemStore();
  const registry = new InstanceRegistry(store);
  return { store, api: new GolemInstanceApi({ registry, store }) };
}

describe("GolemInstanceApi", () => {
  it("createInstance 返回 meta 且 listInstances 反映它", async () => {
    const { api } = makeApi();
    const m = await api.createInstance("a", "阿一", "persona-x");
    expect(m.id).toBe("a");
    expect(m.name).toBe("阿一");
    expect(m.persona).toBe("persona-x");
    const all = await api.listInstances();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("a");
  });

  it("createInstance 幂等（重复创建返回既有 meta，不覆盖）", async () => {
    const { api } = makeApi();
    await api.createInstance("a", "阿一");
    const m2 = await api.createInstance("a", "改名?");
    expect(m2.name).toBe("阿一");
  });

  it("getInstanceMeta 未知实例返回 null", async () => {
    const { api } = makeApi();
    expect(await api.getInstanceMeta("nope")).toBeNull();
  });

  it("setInstanceMeta 字段级合并：更新 name/persona，保护 id/createdAt/turns", async () => {
    const { api, store } = makeApi();
    const m = await api.createInstance("a", "阿一", "old-persona");
    const createdAt = m.createdAt;
    const updated = await api.setInstanceMeta("a", {
      name: "阿一改名",
      persona: "new-persona",
      id: "hack",
      createdAt: 0,
      turns: 999,
    } as Partial<InstanceMeta>);
    expect(updated.name).toBe("阿一改名");
    expect(updated.persona).toBe("new-persona");
    expect(updated.id).toBe("a"); // 受保护
    expect(updated.createdAt).toBe(createdAt); // 受保护
    expect(updated.turns).toBe(0); // 受保护
    const persisted = await store.getMeta("a");
    expect(persisted?.persona).toBe("new-persona");
    expect(persisted?.name).toBe("阿一改名");
  });

  it("setInstanceMeta 仅合并传入字段，未传字段保持不变", async () => {
    const { api } = makeApi();
    await api.createInstance("a", "阿一", "persona-x");
    const updated = await api.setInstanceMeta("a", { name: "只改名字" });
    expect(updated.name).toBe("只改名字");
    expect(updated.persona).toBe("persona-x"); // 未传 → 保留
  });

  it("setInstanceMeta 未知实例抛错，不会凭空创建", async () => {
    const { api, store } = makeApi();
    await expect(api.setInstanceMeta("ghost", { name: "x" })).rejects.toThrow(/not found/);
    expect(await store.getMeta("ghost")).toBeNull();
  });

  it("默认实例可往返（先 null，set 后可读回）", async () => {
    const { api } = makeApi();
    await api.createInstance("a", "阿一");
    expect(await api.getDefaultInstance()).toBeNull();
    await api.setDefaultInstance("a");
    expect(await api.getDefaultInstance()).toBe("a");
  });
});
