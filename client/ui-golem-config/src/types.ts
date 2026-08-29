import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/**
 * 与 golem 服务端 `src/types.ts` 的 `InstanceMeta` 保持一致的客户端镜像类型。
 * 客户端不引入服务端包（保证 bundle 纯度）；此类型须随服务端同步变更。
 */
export interface InstanceMeta {
  id: string
  name: string
  persona?: string
  createdAt: number
  turns: number
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
}
