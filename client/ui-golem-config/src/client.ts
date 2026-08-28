// browser half（package.json `exports["./client"]` → lib/client.js）
// dsh 浏览器 runtime 从本文件导入 `apply` / `inject` 并调用 `apply(ctx)`。
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// 副作用类型导入：把 `settings.section` 这一 list-slot 的 SlotMap 声明
// （含 owner 的 `close` prop 与 list 形参约束）并入本包的 `ctx.slots` 面，
// 否则 `ctx.slots.inject('settings.section', ...)` 会落到默认 `"root"` 重载而报错。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createGolemApi } from './golem-api.ts'
import { GolemSettings } from './GolemSettings.tsx'
import type { GolemRemoteApi } from './types.ts'

// 把 `golem` remote 命名空间并入 `ctx.remote` 的类型面，使 `ctx.remote.golem.*`
// 在 client 代码中获得完整类型。与服务端 `GolemRemoteService` 暴露的 6 个
// `@Remote` 方法一一对应（见 golem 仓库 `src/golem-remote.ts`）。
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    golem: GolemRemoteApi
  }
}

export type { GolemRemoteApi, InstanceMeta } from './types.ts'

/** 依赖的 client 服务：remote + 由桥接包 golem-client-remote 经 $mount 建立的
 *  `remote.golem` 命名空间（必须显式 inject 'remote.golem' 才能经 ctx.remote.golem
 *  访问；参照 dsh 内置 ui-goal 的 'remote.goals'）+ slots（设置面板注册）。 */
export const inject = ['remote', 'remote.golem', 'slots']

/**
 * 客户端插件入口：挂载 golem remote 贡献，并注册「假人」设置面板 section。
 * @param ctx - dsh client 根上下文。
 * @returns disposer：卸载 remote 贡献（section 注册随插件 fiber 自动回收）。
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // `remote.golem` 命名空间由独立桥接包 `golem-client-remote` 经 $mount 建立
  // （见该包 apply），本包仅 inject 消费，避免「自 mount → pending → 死锁」。
  const api = createGolemApi(ctx.remote.golem)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'golem',
        order: 90,
        label: () => '假人',
        inject: () => ({ api }),
      },
      GolemSettings,
    ),
  )
  return async () => {}
}
