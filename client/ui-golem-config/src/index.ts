// host half（package.json `exports["."]` → lib/index.js）
//
// 纯客户端 UI 包：真正的浏览器逻辑在 `./client`（注册 settings.section +
// ctx.remote.$mount golem 贡献）。host 半只让 dsh 识别本包为 client 插件，
// 不在此执行任何依赖浏览器服务的逻辑——否则 host 加载本包时会等待
// ctx.remote / ctx.slots（仅浏览器侧存在）而 pending（初版即踩此坑）。
export const name = 'golem-client-ui-config'

// host 侧不挂载任何服务；浏览器侧由 ./client 的 apply 完成注册。
export function apply(): void {
  // no-op on host
}
