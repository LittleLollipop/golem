/**
 * GolemInstanceApi — 「多假人实例」管理的纯逻辑层（无 dsh / Cordis 依赖）。
 *
 * 抽出来是为了两件事：
 *  1. 让核心逻辑可独立单测——golem 的 vitest 默认不转译 TC39 装饰器，而
 *     RPC 表面（GolemRemoteService 的 @Remote）需要装饰器；把逻辑放这里，
 *     测试直接 import 本文件即可，不触碰装饰器运行时。
 *  2. 与 RPC 表面解耦：GolemRemoteService 只是 @Remote 薄包装，委托本类。
 *
 * 关键修复（相对旧独立页 / server.py 平行 REST）：
 *  - setInstanceMeta 改为「字段级合并」，不再整体覆盖 meta（根除丢失字段 bug）。
 *  - 不再依赖 sidecar 平行 REST；数据统一走 dsh seam / remote。
 */

import type { InstanceId, InstanceMeta } from "./types.js";
import type { GraphStore } from "./memory/graph-store.js";
import type { InstanceRegistry } from "./registry/instance-registry.js";

export interface GolemInstanceDeps {
  readonly registry: InstanceRegistry;
  readonly store: GraphStore;
}

export class GolemInstanceApi {
  private readonly registry: InstanceRegistry;
  private readonly store: GraphStore;

  constructor(deps: GolemInstanceDeps) {
    this.registry = deps.registry;
    this.store = deps.store;
  }

  /** 列出全部假人实例（id/name/createdAt/turns/persona）。 */
  async listInstances(): Promise<InstanceMeta[]> {
    return this.registry.list();
  }

  /**
   * 新建一个假人实例（幂等：已存在则直接返回既有 meta）。
   * persona 可选；缺省时由 agent 回退到默认人格（#27）。
   */
  async createInstance(
    id: InstanceId,
    name: string,
    persona?: string,
    opts?: { personaCore?: string; personaExt?: string },
  ): Promise<InstanceMeta> {
    return this.registry.create(id, name, persona, opts);
  }

  /** 读取单实例 meta，不存在返回 null。 */
  async getInstanceMeta(id: InstanceId): Promise<InstanceMeta | null> {
    return this.registry.meta(id);
  }

  /**
   * 字段级更新实例 meta（不再整体覆盖，根除丢失字段 bug）。
   * 仅合并 name / persona；id / createdAt / turns 为受保护字段，patch 中的
   * 这些值被忽略，保证调用方无法篡改身份与时间统计。
   * 实例不存在时抛错（不会凭空创建）。
   */
  async setInstanceMeta(id: InstanceId, patch: Partial<InstanceMeta>): Promise<InstanceMeta> {
    const existing = await this.store.getMeta(id);
    if (existing === null) {
      throw new Error(`golem: instance "${id}" not found; cannot patch meta`);
    }
    const updated: InstanceMeta = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      turns: existing.turns,
    };
    await this.store.setMeta(id, updated);
    return updated;
  }

  /** 读取当前默认实例 id（可能为 null）。 */
  async getDefaultInstance(): Promise<InstanceId | null> {
    return this.store.getDefaultInstance();
  }

  /** 删除一个假人实例（含其记忆图与 meta）。default 实例受 sidecar 保护会失败。 */
  async deleteInstance(id: InstanceId): Promise<void> {
    await this.registry.delete(id);
  }

  /** 设置默认实例 id（供新会话默认选中，req_iso_session_select）。 */
  async setDefaultInstance(id: InstanceId): Promise<void> {
    await this.store.setDefaultInstance(id);
  }
}
