/**
 * GolemRemoteService — 把「多假人实例」管理暴露为 dsh 可扩展 remote 通道
 * (TypertRemoteService)，供基座设置面板客户端经 `ctx.remote.golem.*` 调用。
 *
 * 这是 D2a 的正统扩展点（零 dsh 核心改动）：golem 服务端经
 * `TypertRemoteService` + `@Remote()` 暴露方法，dsh gateway 的 source-mode
 * 发现（读 `typertRemote` 绑定 + `remoteMethods`）即可路由；客户端经
 * `ctx.remote.$mount(contribution)` 拿到 typed 调用面。
 *
 * 本类只做 RPC 表面（@Remote 包装），业务逻辑委托 GolemInstanceApi。
 * 注册方式（与 dsh 原生插件一致）：`ctx.plugin(GolemRemoteService, config)`，
 * 由 Cordis 容器把实例登记到 `ctx.get('golem')`，gateway 据此发现。
 */

import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";
import { GolemInstanceApi } from "./golem-instance-api.js";
import { AxolotlClient } from "./memory/axolotl-client.js";
import { InstanceRegistry } from "./registry/instance-registry.js";
import type { InstanceId, InstanceMeta } from "./types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    golem: GolemRemoteService;
  }
}

export interface GolemRemoteConfig {
  /** axolotl sidecar 地址；缺省走 AxolotlClient 默认（环境变量 / 127.0.0.1:8741）。 */
  sidecarUrl?: string;
}

export class GolemRemoteService extends TypertRemoteService {
  static inject: string[] = [];

  private readonly api: GolemInstanceApi;

  constructor(ctx: unknown, config: GolemRemoteConfig = {}) {
    super(ctx as never, "golem");
    const store = new AxolotlClient(config.sidecarUrl);
    const registry = new InstanceRegistry(store);
    this.api = new GolemInstanceApi({ registry, store });
  }

  @Remote("listInstances")
  listInstances(): Promise<InstanceMeta[]> {
    return this.api.listInstances();
  }

  @Remote("createInstance")
  createInstance(id: InstanceId, name: string, persona?: string): Promise<InstanceMeta> {
    return this.api.createInstance(id, name, persona);
  }

  @Remote("getInstanceMeta")
  getInstanceMeta(id: InstanceId): Promise<InstanceMeta | null> {
    return this.api.getInstanceMeta(id);
  }

  @Remote("setInstanceMeta")
  setInstanceMeta(id: InstanceId, patch: Partial<InstanceMeta>): Promise<InstanceMeta> {
    return this.api.setInstanceMeta(id, patch);
  }

  @Remote("getDefaultInstance")
  getDefaultInstance(): Promise<InstanceId | null> {
    return this.api.getDefaultInstance();
  }

  @Remote("setDefaultInstance")
  setDefaultInstance(id: InstanceId): Promise<void> {
    return this.api.setDefaultInstance(id);
  }
}
