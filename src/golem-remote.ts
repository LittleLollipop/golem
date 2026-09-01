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
import {
  activeDimDefs,
  inferTraitBaseline,
  readDriftRecords,
  resolveCorePersona,
  TRAIT_DIM_DEFS,
} from "./agent/persona-drift.js";
import { loadPersonaDriftConfig } from "./leak/config.js";
import { HttpLlmClient, type LlmClient } from "./llm/client.js";
import { readKnowledgeRecords } from "./knowledge/ledger-read.js";
import type { InstanceId, InstanceMeta } from "./types.js";
import type {
  DriftExecutionResult,
  DriftDimDef,
  TraitDimDef,
} from "./agent/persona-drift.js";
import type { LearnedFact } from "./knowledge/types.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    golem: GolemRemoteService;
  }
}

export interface GolemRemoteConfig {
  /** axolotl sidecar 地址；缺省走 AxolotlClient 默认（环境变量 / 127.0.0.1:8741）。 */
  sidecarUrl?: string;
  /**
   * 注入的 LLM 客户端（测试用）。不传则从环境变量懒构造 HttpLlmClient；
   * 环境变量也没有 → `inferTraitBaseline` 返回 `no-llm` 失败，其它接口不受影响。
   */
  llm?: LlmClient;
}

/** 维度定义的下发形状：漂移维度 + Trait 坐标维度（后端单一真源，§9.1）。 */
export interface DriftDimsPayload {
  /** 当前实际生效的漂移维度（已按 FAKEREN_DRIFT_DIMS 过滤）。 */
  drift: DriftDimDef[];
  /** HEXACO 六维人格坐标定义（含 drifts 标记，供 UI 灰显不参与漂移的维度）。 */
  trait: TraitDimDef[];
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
  private readonly injectedLlm?: LlmClient;

  constructor(ctx: unknown, config: GolemRemoteConfig = {}) {
    super(ctx as never, "golem");
    const store = new AxolotlClient(config.sidecarUrl);
    const registry = new InstanceRegistry(store);
    this.api = new GolemInstanceApi({ registry, store });
    this.injectedLlm = config.llm;
  }

  /**
   * 懒构造 LLM 客户端。没有 API key 时返回 undefined（而不是抛异常）——
   * 缺 LLM 只影响「自动推断人格坐标」这一个按钮，不该拖垮整个 remote 服务。
   */
  private llm(): LlmClient | undefined {
    if (this.injectedLlm) return this.injectedLlm;
    try {
      return new HttpLlmClient();
    } catch {
      return undefined;
    }
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

  /**
   * 下发维度定义（docs/persona-drift-dimensions.md §9.1）。
   *
   * 旧实现把维度名与中文标签硬编码在 `DriftDashboard.tsx`，维度一改 UI 立即
   * 错位（新维度渲染成裸 key）。现在前端只做渲染，定义在后端单一维护。
   */
  @Remote("getDriftDims")
  getDriftDims(): Promise<RemoteResult<DriftDimsPayload>> {
    const cfg = loadPersonaDriftConfig();
    return Promise.resolve(
      ok({ drift: activeDimDefs(cfg.dims), trait: [...TRAIT_DIM_DEFS] }),
    );
  }

  /**
   * 用 LLM 从核心人设推断 HEXACO 六维基线并**写入 meta**（§6.1 路径①）。
   *
   * ⚠️ 只由用户点 UI 按钮触发。内省路径绝不自动写回——meta 写入与 UI 编辑
   * 存在并发窗口，静默写会覆盖用户刚改的东西（§12-Q2）。
   */
  @Remote("inferTraitBaseline")
  async inferTraitBaseline(id: InstanceId): Promise<RemoteResult<InstanceMeta>> {
    try {
      const meta = await this.api.getInstanceMeta(id);
      if (!meta) return fail("instance-not-found", `golem: instance "${id}" not found`);
      const llm = this.llm();
      if (!llm) {
        return fail(
          "no-llm",
          "未配置 LLM（设置 DEEPSEEK_API_KEY / FAKEREN_LLM_API_KEY 后可用）",
        );
      }
      const core = resolveCorePersona(meta, "");
      if (!core.trim()) {
        return fail("empty-persona", "核心人设为空，先填写核心人格再推断");
      }
      const traitBaseline = await inferTraitBaseline(core, llm);
      const updated = await this.api.setInstanceMeta(id, { traitBaseline });
      return ok(updated);
    } catch (error) {
      return fail(
        "trait-infer-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * 读取某实例的全部知识获取轨迹（随机轨 + 目的轨）。文件不存在返回空数组。
   * 数据来自 DailyKnowledgeTracker 写入的 `<knowledgeDir>/<inst>.json` 的 trajectory。
   */
  @Remote("getKnowledgeRecords")
  async getKnowledgeRecords(instanceId: InstanceId): Promise<RemoteResult<LearnedFact[]>> {
    try {
      return ok(readKnowledgeRecords(instanceId));
    } catch (error) {
      return fail(
        "knowledge-read-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
