import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GolemRemoteApi,
  InstanceMeta,
  DriftExecutionResult,
  DriftDimsPayload,
  LearnedFact,
} from './types.ts'

/**
 * 把 `ctx.remote.golem`（返回 `RemoteResult<T>`）包成「直接返回 T、失败时抛错」
 * 的 controller，供 React 组件调用——与 dsh 既有 client controller 的惯用法一致
 * （如 `MessageFeedbackController` 包 `ctx.remote.messageFeedback`）。
 */
export interface GolemApi {
  listInstances(): Promise<InstanceMeta[]>
  createInstance(id: string, name: string, persona?: string): Promise<InstanceMeta>
  getInstanceMeta(id: string): Promise<InstanceMeta | null>
  setInstanceMeta(id: string, patch: Partial<InstanceMeta>): Promise<InstanceMeta>
  getDefaultInstance(): Promise<string | null>
  setDefaultInstance(id: string): Promise<null>
  deleteInstance(id: string): Promise<null>
  getDriftRecords(instanceId: string): Promise<DriftExecutionResult[]>
  getKnowledgeRecords(instanceId: string): Promise<LearnedFact[]>
  /** 维度定义（后端单一真源，前端不硬编码，§9.1）。 */
  getDriftDims(): Promise<DriftDimsPayload>
  /** 用 LLM 从核心人设推断 HEXACO 六维基线并写入 meta。 */
  inferTraitBaseline(id: string): Promise<InstanceMeta>
}

/**
 * 解包 `ctx.remote.golem.*` 返回的 `RemoteResult<T>`。
 *
 * 关键约定：dsh gateway 客户端（`api/gateway/lib/client.js` 的 `invokeRemote`）
 * 总是把结果包成一层 `{ ok: true, value }`，value 是用 descriptor 的 `result`
 * codec 解析出的【业务载荷】。而本服务 host 侧 `GolemRemoteService` 的 `@Remote`
 * 方法又用 `ok()/fail()` 包了一层 `RemoteResult`（与 message-feedback 等原生插件
 * 一致），所以线上实际是「双层 RemoteResult」：
 *   { ok:true, value:{ ok:true, value:[...] } }
 * 因此这里**递归**解包——只要还是 `{ ok:boolean, ... }` 形状就继续往下剥，直到
 * 拿到真正的业务载荷（数组 / 字符串 / null / void）。fail 分支（ok:false）抛错。
 *
 * 递归对业务值类型（InstanceMeta 无 `ok` 字段、数组、字符串、null、void）绝对安全：
 * 这些值的 `ok` 都不是布尔，循环会在叶子处停下。
 */
type RemoteFailure = { code: string; message: string; details?: unknown }
type AnyResult = { ok: true; value: unknown } | { ok: false; error: RemoteFailure }

function unwrap<T>(r: unknown): T {
  if (r !== null && typeof r === 'object' && 'ok' in r) {
    const res = r as AnyResult
    if (res.ok) return unwrap<T>(res.value)
    const err = (res as { error?: RemoteFailure }).error
    throw new Error(`[golem] remote error: ${err?.message ?? 'unknown failure'} (${err?.code ?? '?'})`)
  }
  return r as T
}

export function createGolemApi(remote: GolemRemoteApi): GolemApi {
  // `unwrap` 的显式类型参数不是装饰：`.then(unwrap)` 会让 TS 把返回值推断成
  // `Promise<unknown>`，每个方法都报 TS2322（pre-existing 类型噪音）。
  return {
    listInstances: () => remote.listInstances().then(unwrap<InstanceMeta[]>),
    createInstance: (id, name, persona) =>
      remote.createInstance(id, name, persona).then(unwrap<InstanceMeta>),
    getInstanceMeta: (id) => remote.getInstanceMeta(id).then(unwrap<InstanceMeta | null>),
    setInstanceMeta: (id, patch) => remote.setInstanceMeta(id, patch).then(unwrap<InstanceMeta>),
    getDefaultInstance: () => remote.getDefaultInstance().then(unwrap<string | null>),
    setDefaultInstance: (id) => remote.setDefaultInstance(id).then(unwrap<null>),
    deleteInstance: (id) => remote.deleteInstance(id).then(unwrap<null>),
    getDriftRecords: (id) => remote.getDriftRecords(id).then(unwrap<DriftExecutionResult[]>),
    getKnowledgeRecords: (id) => remote.getKnowledgeRecords(id).then(unwrap<LearnedFact[]>),
    getDriftDims: () => remote.getDriftDims().then(unwrap<DriftDimsPayload>),
    inferTraitBaseline: (id) => remote.inferTraitBaseline(id).then(unwrap<InstanceMeta>),
  }
}
