import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { golemRemoteContribution } from './golem-remote-contribution.ts'
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

/** 依赖的 client 服务：remote（TypertRemoteService 挂载面）+ slots（设置面板注册）。 */
export const inject = ['remote', 'slots']

/**
 * 客户端插件入口：挂载 golem remote 贡献，并注册「假人」设置面板 section。
 * @param ctx - dsh client 根上下文。
 * @returns disposer：卸载 remote 贡献（section 注册随插件 fiber 自动回收）。
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(golemRemoteContribution)
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
  return async () => {
    await disposeRemote()
  }
}
