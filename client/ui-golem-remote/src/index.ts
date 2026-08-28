// host half（package.json `exports["."]` → lib/index.js）
// dsh 在 host（server）进程加载本包时执行。本桥只在浏览器侧 $mount remote，
// host 侧无需任何动作，故为 no-op，不声明依赖、不 pending。
export default {
  name: 'golem-client-remote',
  apply() {},
}
