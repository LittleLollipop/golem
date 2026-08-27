import { defineConfig } from 'tsdown'

// 预构建客户端 bundle：dsh web 组装时消费 `exports["./client"]`（lib/client.js）。
// 此包在 dsh monorepo 内借用其 node_modules 解析 `@deepseek-ai/dsh-*` 客户端依赖后构建。
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
  },
  outDir: 'lib',
  format: 'esm',
  dts: true,
  clean: true,
  target: 'es2022',
  // 该包 `"type": "module"，dsh web 组装按 package.json `exports["./client"]`
  // (./lib/client.js) 消费产物，故强制输出 .js / .d.ts（否则 esm 默认 .mjs）。
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
