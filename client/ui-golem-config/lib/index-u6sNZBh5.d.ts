import { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";

//#region src/types.d.ts
/**
 * 与 golem 服务端 `src/types.ts` 的 `InstanceMeta` 保持一致的客户端镜像类型。
 * 客户端不引入服务端包（保证 bundle 纯度）；此类型须随服务端同步变更。
 */
interface InstanceMeta {
  id: string;
  name: string;
  persona?: string;
  createdAt: number;
  turns: number;
}
/**
 * `ctx.remote.golem` 的 typed 面（经 `@deepseek-ai/dsh-typert-protocol` 的
 * `TypertRemoteNamespaceMap` 合并声明）。每个方法返回 `RemoteResult<T>`：
 * `{ ok: true, value }` 或 `{ ok: false, error }`。
 */
interface GolemRemoteApi {
  listInstances(): Promise<RemoteResult<InstanceMeta[]>>;
  createInstance(id: string, name: string, persona?: string): Promise<RemoteResult<InstanceMeta>>;
  getInstanceMeta(id: string): Promise<RemoteResult<InstanceMeta | null>>;
  setInstanceMeta(id: string, patch: Partial<InstanceMeta>): Promise<RemoteResult<InstanceMeta>>;
  getDefaultInstance(): Promise<RemoteResult<string | null>>;
  setDefaultInstance(id: string): Promise<RemoteResult<void>>;
}
//#endregion
//#region src/index.d.ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    golem: GolemRemoteApi;
  }
}
/** 依赖的 client 服务：remote（TypertRemoteService 挂载面）+ slots（设置面板注册）。 */
declare const inject: string[];
/**
 * 客户端插件入口：挂载 golem remote 贡献，并注册「假人」设置面板 section。
 * @param ctx - dsh client 根上下文。
 * @returns disposer：卸载 remote 贡献（section 注册随插件 fiber 自动回收）。
 */
declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;
//#endregion
export { InstanceMeta as i, inject as n, GolemRemoteApi as r, apply as t };