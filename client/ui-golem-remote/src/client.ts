// browser half（package.json `exports["./client"]` → lib/client.js）
// dsh 浏览器 runtime 从本文件导入 `apply` / `inject` 并调用 `apply(ctx)`。
//
// 本包是 golem remote 通道的【挂载桥】：apply 内 `ctx.remote.$mount(...)` 在
// 客户端动态注册 `remote.golem` 命名空间（cordis service `remote.golem`）。
//
// 关键：本包 inject 仅 `['remote']`，【不】依赖 `remote.golem` 本身，因此能被
// cordis 立即激活；激活后 `remote.golem` 建立，消费包（golem-client-ui-config，
// inject `['remote', 'remote.golem', 'slots']`）随即解除 pending。这正是 dsh
// 基座 `dsh-api-remotes`（独立 mount 包）与 `ui-goal`（消费包 inject
// `remote.goals`）的分工模式——自定义 remote 不能在消费包内自 mount（会导致
// 「inject remote.golem → pending → 自身 apply 不跑 → 死锁」）。
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { golemRemoteContribution } from './golem-remote-contribution.ts'

export const inject = ['remote']

/**
 * 挂载 golem Remote 贡献，建立 `ctx.remote.golem` 命名空间。
 * @param ctx - dsh client 根上下文。
 * @returns disposer：卸载 remote 贡献。
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const dispose = await ctx.remote.$mount(golemRemoteContribution)
  return async () => {
    await dispose()
  }
}
