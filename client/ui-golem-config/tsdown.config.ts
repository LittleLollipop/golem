import { defineConfig } from 'tsdown'

// 预构建客户端 bundle：dsh web 组装时消费 `exports["./client"]`（lib/client.js）。
//
// 两个 half（对齐 dsh 标准 client 包 ui-model-selection）：
//  - index（host 半，exports["."] → lib/index.js）：纯 no-op（`src/index.ts`），
//    dsh 在 host 进程加载本包时执行，不依赖浏览器服务，故不 pending。
//  - client（browser 半，exports["./client"] → lib/client.js）：真正的 apply
//    （`src/client.ts`），按 dsh 浏览器 loader 契约包成
//    `window.__ModuleLoader__.load({ id, factory })`，供基座运行时以模块表方式
//    注入 cordis 实体后执行。
//
// 注意：本包在 dsh monorepo 内借用其 node_modules 解析 `@deepseek-ai/dsh-*`
// 客户端依赖与 react 后构建。运行时只依赖 react（GolemSettings 组件），
// `@deepseek-ai/*` 在本包代码里全是 type-only 导入（被擦除），故只需把
// react 标记为 external，由 dsh 模块表注入。
const CLIENT_ID = 'golem-client-ui-config'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: true,
    clean: false,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: true,
    clean: false,
    external: ['react'],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // dsh 浏览器 loader 契约：把 bundle 注册为模块表一行，factory 内以
      // cordis 模块表实体（require）解析外部依赖。
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
