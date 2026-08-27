// dsh web 组装消费的浏览器 bundle 入口（package.json `exports["./client"]`）。
// dsh client runtime 从本文件导入 `apply` / `inject` 并调用 `apply(ctx)`。
export { apply, inject } from './index.ts'
