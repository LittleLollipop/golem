import { defineConfig } from 'tsdown'

// 浏览器 remote 挂载桥的预构建 bundle。结构对齐 dsh 标准 client 包的双 half：
//  - index（host 半，exports["."] → lib/index.js）：纯 no-op（`src/index.ts`），
//    dsh 在 host 进程加载本包时执行，不依赖浏览器服务，故不 pending。
//  - client（browser 半，exports["./client"] → lib/client.js）：真正的 apply
//    （`src/client.ts`），按 dsh 浏览器 loader 契约包成
//    `window.__ModuleLoader__.load({ id, factory })`，供基座运行时以模块表方式
//    注入 cordis 实体后执行；apply 内 `ctx.remote.$mount(golemRemoteContribution)`
//    建立 `remote.golem` 命名空间。
//
// 本包在 dsh monorepo 内借用其 node_modules 解析 `@deepseek-ai/dsh-*` 依赖后构建。
// 运行期只用到 zod（贡献描述符的 strict codec schema），react 无关；
// zod 必须打进 bundle（dsh 浏览器模块表未注册 zod），故仅 react 标 external。
const CLIENT_ID = 'golem-client-remote'

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
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
