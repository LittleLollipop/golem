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
 *
 * ⚠️ 返回值约定（与 dsh 原生 remote 一致，参照 message-feedback）：
 * `@Remote` 方法必须返回 `RemoteResult<T>` 联合体（`{ok:true,value}` /
 * `{ok:false,error}`），gateway 不做二次包裹，线上结果即该联合体；
 * 客户端贡献描述符用 strict zod codec 解析它，再由 `createGolemApi` 解包。
 */

import { TypertRemoteService, Remote, type RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import { GolemInstanceApi } from "./golem-instance-api.js";
import { AxolotlClient } from "./memory/axolotl-client.js";
import { InstanceRegistry } from "./registry/instance-registry.js";
import { readDriftRecords } from "./agent/persona-drift.js";
import type { InstanceId, InstanceMeta } from "./types.js";
import type { DriftExecutionResult } from "./agent/persona-drift.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    golem: GolemRemoteService;
  }
}

export interface GolemRemoteConfig {
  /** axolotl sidecar 地址；缺省走 AxolotlClient 默认（环境变量 / 127.0.0.1:8741）。 */
  sidecarUrl?: string;
}

/** 成功分支：冻结的 `{ ok: true, value }`。 */
function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value };
}

/** 业务失败分支：冻结的 `{ ok: false, error }`（RemoteFailure 形状）。 */
function fail<T = never>(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): RemoteResult<T> {
  return { ok: false, error: { code, message, details } };
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
  listInstances(): Promise<RemoteResult<InstanceMeta[]>> {
    return this.api.listInstances().then(ok);
  }

  @Remote("createInstance")
  createInstance(id: InstanceId, name: string, persona?: string): Promise<RemoteResult<InstanceMeta>> {
    return this.api.createInstance(id, name, persona).then(ok);
  }

  @Remote("getInstanceMeta")
  getInstanceMeta(id: InstanceId): Promise<RemoteResult<InstanceMeta | null>> {
    return this.api.getInstanceMeta(id).then(ok);
  }

  @Remote("setInstanceMeta")
  setInstanceMeta(id: InstanceId, patch: Partial<InstanceMeta>): Promise<RemoteResult<InstanceMeta>> {
    return this.api.setInstanceMeta(id, patch).then(ok, (error) =>
      fail("instance-meta-write-failed", error instanceof Error ? error.message : String(error)),
    );
  }

  @Remote("getDefaultInstance")
  getDefaultInstance(): Promise<RemoteResult<InstanceId | null>> {
    return this.api.getDefaultInstance().then(ok);
  }

  @Remote("setDefaultInstance")
  setDefaultInstance(id: InstanceId): Promise<RemoteResult<null>> {
    return this.api.setDefaultInstance(id).then(
      () => ok(null),
      (error) =>
        fail("default-instance-write-failed", error instanceof Error ? error.message : String(error)),
    );
  }

  @Remote("deleteInstance")
  deleteInstance(id: InstanceId): Promise<RemoteResult<null>> {
    return this.api.deleteInstance(id).then(
      () => ok(null),
      (error) =>
        fail("instance-delete-failed", error instanceof Error ? error.message : String(error)),
    );
  }

  /**
   * 读取某实例的全部内省执行记录（时间序列，按文件内顺序）。
   * 文件不存在（尚未跑过内省）返回空数组而非报错。数据来自
   * FileDriftReporter 追加的 `<reportDir>/<inst>.drift-records.jsonl`。
   */
  @Remote("getDriftRecords")
  getDriftRecords(instanceId: InstanceId): Promise<RemoteResult<DriftExecutionResult[]>> {
    return readDriftRecords(instanceId).then(ok, (error) =>
      fail("drift-read-failed", error instanceof Error ? error.message : String(error)),
    );
  }
}
