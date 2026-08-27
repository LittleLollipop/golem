import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { GolemRemoteApi, InstanceMeta } from './types.ts'

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
  setDefaultInstance(id: string): Promise<void>
}

function unwrap<T>(r: RemoteResult<T>): T {
  if (!r.ok) throw new Error(`golem remote error: ${r.error.message}`)
  return r.value
}

export function createGolemApi(remote: GolemRemoteApi): GolemApi {
  return {
    listInstances: () => remote.listInstances().then(unwrap),
    createInstance: (id, name, persona) => remote.createInstance(id, name, persona).then(unwrap),
    getInstanceMeta: (id) => remote.getInstanceMeta(id).then(unwrap),
    setInstanceMeta: (id, patch) => remote.setInstanceMeta(id, patch).then(unwrap),
    getDefaultInstance: () => remote.getDefaultInstance().then(unwrap),
    setDefaultInstance: (id) => remote.setDefaultInstance(id).then(unwrap),
  }
}
