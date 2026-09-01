import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/**
 * 与 golem 服务端 `src/types.ts` 的 `InstanceMeta` 保持一致的客户端镜像类型。
 * 客户端不引入服务端包（保证 bundle 纯度）；此类型须随服务端同步变更。
 */
/**
 * HEXACO 六维人格坐标（Trait 层）。
 * 与 golem 服务端 `src/types.ts` 的 TraitBaseline 保持一致；每维 ∈ [-1, 1]。
 */
export interface TraitBaseline {
  /** 诚实-谦逊（高 = 不投机、不虚荣） */
  H: number
  /** 情绪性（高 = 易担忧、易受伤） */
  E: number
  /** 外向性（高 = 社交自信、活跃） */
  X: number
  /** 宜人性（高 = 温顺包容；低 = 爱抬杠） */
  A: number
  /** 尽责性（高 = 有条理、自律） */
  C: number
  /** 经验开放性（高 = 好奇、爱联想） */
  O: number
}

export interface InstanceMeta {
  id: string
  name: string
  persona?: string
  /**
   * 常驻核心人格：身份锚 + 红线/不可违背指令 + 性格维度基线 + 行为护栏。
   * 每 session 注入，从不写入图库（docs/persona-layering.md）。
   */
  personaCore?: string
  /**
   * 进图库扩展设定：背景故事 / 关系网络 / 偏好禁忌实例 / 历史事件。
   * 按需经 recall 拉取，seed 进 axolotl 图（docs/persona-layering.md）。
   */
  personaExt?: string
  /**
   * HEXACO 六维人格坐标。每个假人标一次，静态；兼作每日漂移的重力中心。
   * 缺失 → 回弹目标退化为 0（功能不中断）。
   */
  traitBaseline?: TraitBaseline
  createdAt: number
  turns: number
}

/** 一个可漂移维度的定义（后端单一真源，经 getDriftDims 下发）。 */
export interface DriftDimDef {
  key: string
  label: string
  pos: string
  neg: string
  layer: 'state' | 'expression'
  scope: string
  notScope: string
}

/** HEXACO 六维坐标定义（含 drifts 标记，false → UI 灰显）。 */
export interface TraitDimDef {
  key: 'H' | 'E' | 'X' | 'A' | 'C' | 'O'
  label: string
  hint: string
  pos: string
  neg: string
  drifts: boolean
}

/** getDriftDims 的返回形状。 */
export interface DriftDimsPayload {
  drift: DriftDimDef[]
  trait: TraitDimDef[]
}

/**
 * 内省执行记录（一次 idle 内省运行的完整轨迹）。
 * 与 golem 服务端 `src/agent/persona-drift.ts` 的 DriftExecutionResult 保持一致；
 * 客户端不引入服务端包，此类型须随服务端同步变更。
 */
export interface DriftExecutionResult {
  instanceId: string
  /** 日历日（ymd）。 */
  date: string
  /** 运行开始的 ISO 时间戳。 */
  triggeredAt: string
  /** 是否真正调用了 LLM（vs 短路/跳过）。 */
  triggered: boolean
  /** 未产出 drift 节点的原因。 */
  skipReason?: 'already-done' | 'no-dialogue' | 'no-llm' | 'model-empty'
  /** 已存在同日 drift 的节点 id（already-done）。 */
  existingNodeId?: string
  /** 调用模型前读取的内容统计。 */
  input?: { dialogTurns: number; recentDays: number; memoryTopics: number; historyDrifts: number }
  /** LLM 原始输出（调试用）。 */
  llmRaw?: string
  /** 模型/解析失败。 */
  error?: 'llm-error' | 'bad-json'
  /** 解析校验后的结果（已写节点时存在）。 */
  parsed?: {
    dims: Record<string, number>
    cumulative: Record<string, number>
    mood?: string
    leaning?: string
    preoccupation?: string
    rationale?: string
    evidence: string[]
    /** 结构化引用：nodeId 已校验为图中真实存在的节点。 */
    evidenceRefs?: Array<{ nodeId?: string; quote: string }>
    /** 本次计算所用的回弹目标（可审计）。 */
    traitTarget?: Record<string, number>
    /** 本次实际施加的回弹量（负值 = 往基线拉回）。 */
    revertPull?: Record<string, number>
  }
  /** 落盘位置。 */
  written?: {
    nodeId: string
    causalEdges: number
    evidenceEdges: number
    /** 悬空引用数（没建成边的 evidence）。 */
    evidenceSkipped: number
  }
}

/**
 * 知识获取轨迹的一条记录（随机轨 / 目的轨各一次尝试的结果）。
 * 与 golem 服务端 `src/knowledge/types.ts` 的 LearnedFact 保持一致；
 * 客户端不引入服务端包，此类型须随服务端同步变更。
 */
export interface LearnedFact {
  id: string
  title: string
  summary: string
  source: string
  sourceUrl: string
  /** epoch ms when learned */
  learnedAt: number
  /** which rank was actually chosen */
  chosenRank: number
  /** human-readable why */
  selectionPath: string
  /** which slot produced this record */
  kind: 'random' | 'purposeful'
  /** outcome of the attempt */
  status: 'learned' | 'empty' | 'junk' | 'error'
  /** present only for purposeful records */
  directive?: { source: string; query?: string; rationale: string }
  /** status note (e.g. "检索返回 0 条" / "源异常: …") */
  statusNote?: string
}

/**
 * `ctx.remote.golem` 的 typed 面（经 `@deepseek-ai/dsh-typert-protocol` 的
 * `TypertRemoteNamespaceMap` 合并声明）。每个方法返回 `RemoteResult<T>`：
 * `{ ok: true, value }` 或 `{ ok: false, error }`。
 */
export interface GolemRemoteApi {
  listInstances(): Promise<RemoteResult<InstanceMeta[]>>
  createInstance(id: string, name: string, persona?: string): Promise<RemoteResult<InstanceMeta>>
  getInstanceMeta(id: string): Promise<RemoteResult<InstanceMeta | null>>
  setInstanceMeta(id: string, patch: Partial<InstanceMeta>): Promise<RemoteResult<InstanceMeta>>
  getDefaultInstance(): Promise<RemoteResult<string | null>>
  setDefaultInstance(id: string): Promise<RemoteResult<null>>
  deleteInstance(id: string): Promise<RemoteResult<null>>
  getDriftRecords(instanceId: string): Promise<RemoteResult<DriftExecutionResult[]>>
  getKnowledgeRecords(instanceId: string): Promise<RemoteResult<LearnedFact[]>>
  /** 维度定义（后端单一真源；前端不再硬编码维度名，§9.1）。 */
  getDriftDims(): Promise<RemoteResult<DriftDimsPayload>>
  /** 用 LLM 从核心人设推断 HEXACO 六维基线并写入 meta（用户显式触发）。 */
  inferTraitBaseline(id: string): Promise<RemoteResult<InstanceMeta>>
}
