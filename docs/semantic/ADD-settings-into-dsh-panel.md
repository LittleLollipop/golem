# 把配置页搬进 dsh 基座设置面板（方案设计）

> **状态：提案（待评审）**。评审通过后再实现 + 回流图库。
> 背景：用户选择把 `public/iso-config.html` 从"独立 sidecar 页面"迁移进 dsh 设置面板（选项 B）。

---

## 0. 已查实的事实（来自代码/文档，非推测）

- **当前配置页是独立 static HTML**：`public/iso-config.html`，由 sidecar `GET /config` 服务。设计意图明确写在 `docs/semantic/IMPLEMENTATION.md` L88：*"独立轻量、不 patch dsh 核心"*。
- **golem 是纯服务端 dsh 插件**：`package.json` 无 `"dsh": { "client" }` 声明；`inject = ["sessionPersistence","userQuestions"]`，`apply()` 只接服务端 seam（agent/pre-step、memory/axolotl、instance registry、signal bus）。
- **dsh 前端机制（核实自 `/tmp/dsh-src` 源码）**：
  - 设置页扩展点是 **`settings.section`** slot（非 `settings.page`）。注册形态：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, children }, Comp))`。样例：`packages/client/ui-settings-general/src/client/index.ts:169`。
  - **dsh 有两条 client→server 类型化通道（关键更正）**：
    - 通道① `connection.api`（类型 `IApiClient`，含 sessions/settings/credentials/llm…）：**硬编码在 `@deepseek-ai/dsh-host-apiproxy`，不可插件扩展**——加 `IApiClient['golem']` 必须改 dsh 核心包，是硬阻塞。
    - 通道② `ctx.remote`（类型 `TypertClientRemote`）：**可插件扩展**。服务端 `TypertRemoteService(ctx,'golem')` + `@Remote()` 方法，客户端 `ctx.remote.$mount(contribution)` 后 surfaced 为 `ctx.remote.golem.*`。**这才是插件暴露 client 可调用服务的正统扩展点，零核心改动。**
  - 客户端插件靠 `package.json` 的 `"dsh": { "client": { inject:[...], platform:"web" } }` 声明注入 web 前端。样例：`packages/client/ui-model-selection/package.json`。
  - dsh web 通过 `pnpm dsh web --patch <yml>` 组装：`/tmp/dsh-src/golem-cordis.yml` 仅做 `- insert: { id: golem, name: 'golem' }`。

---

## 1. 目标

配置页成为 dsh 设置面板里的一个 section（`id: 'golem'`），复用 dsh 设置 shell（trigger/header/close 全由 shell 提供，registrant 只供内容）。UI 与基座一致，**根除当前 sidecar 平行 REST 的契约分裂**（真 axolotl 后端 `server.py` 缺 `do_PUT` + 配置路由，导致独立页切真后端全 404/501）。

预期效果：设置面板 → 假人 section → 实例列表 / 新建 / 设 persona / 设默认。

---

## 2. 两个待定关键决策（需你拍板）

### D1：客户端包放在哪

- **D1a｜放进 dsh monorepo 本地补丁**：仿现有 `MessageItem.tsx` 前端补丁，在 `/tmp/dsh-src/packages/client/ui-golem-config/` 落地。
  - ✅ 符合现状、dsh web 构建直接消费。
  - ❌ 不在 golem 仓库，*换 dsh 版本需重贴*（IMPLEMENTATION.md 已记此痛）。
- **D1b｜放进 golem 仓库**：如 `client/ui-golem-config/`，借现有 `node_modules/golem -> /Users/sai/WorkBuddy/dev/golem` 软链，被 dsh web 构建消费。
  - ✅ 随 golem 版本走、不 patch dsh 核心、贴合"golem 自包含插件"定位。
  - ❌ 需确认 dsh web 构建能 bundle 仓库外 client 包（**可行性待验证，见 §5 开放项**）。

> ✅ **已选 D1b**（2026-08-27 用户拍板）：客户端包放进 golem 仓库，随版本走、不 patch dsh 核心。可行性前提见 §5-1，动码前必查实。

### D2：客户端怎么拿后端数据

- **D2a｜经 dsh seam / remote（正统，已查实走 `ctx.remote.golem`）**：golem 服务端插件注册一个 `TypertRemoteService(ctx,'golem')`，用 `@Remote()` 暴露 `listInstances / createInstance / getInstanceMeta / setInstanceMeta / getDefaultInstance / setDefaultInstance`；客户端经 `ctx.remote.golem.*` typed 调用。最贴合你原话"对齐 dsh 记忆/runtime seam、不再依赖 sidecar 平行 REST"。**不走 `IApiClient`（不可扩展），走可扩展的 `ctx.remote` 通道——零核心改动。**
- **D2b｜客户端直接 fetch 假人 sidecar REST**：把 `server.py` 缺失的配置接口补齐全后，配置 UI 仍调 sidecar 自有 REST。
  - ✅ 改动小、不碰 `dsh-api-remotes`。
  - ❌ 配置 UI 仍依赖"sidecar 平行 REST"这条契约，只是把它在真后端补齐，未从根上消除平行契约。

> ✅ **已选 D2a**（2026-08-27 用户拍板）：客户端数据走 dsh seam / typed remote，根除 sidecar 平行 REST。前提见 §5-2（`dsh-api-remotes` 扩展机制），动码前必查实。

---

## 3. 目标架构（草图）

```
[server plugin]  AxolotlClient + InstanceRegistry
        │  注册 TypertRemoteService(ctx,'golem')（D2a，@Remote 暴露 6 方法）
        ▼
  ctx.remote.golem.*  (可扩展 remote 名空间，零核心改动)
        │  typed remote（ctx.remote.golem.listInstances ...）
        ▼
[client package ui-golem-config]  注册 settings.section(id:'golem')
        │  渲染
        ▼
  dsh 设置面板 → 「假人」section（列表/新建/设 persona/设默认）
```

若选 D2b，最下一截改为「客户端 fetch sidecar REST」，`server.py` 补齐配置路由。

---

## 4. 文件清单（按决策落地）

| 动作 | 路径 | 说明 |
|---|---|---|
| 新增 | `client/ui-golem-config/package.json` | 真实包名 + `exports["./client"]` 预构建 bundle + `"dsh":{client:{platform:"web"}}` |
| 新增 | `client/ui-golem-config/src/index.ts` | 注册 `settings.section(id:'golem',label:'假人')` + `ctx.remote.$mount(golemContribution)` |
| 新增 | `client/ui-golem-config/src/GolemSettings.tsx` | 复用现有交互（列表/新建/设 persona/设默认），数据走 `ctx.remote.golem.*` |
| 新增 | `src/golem-remote.ts` | `GolemRemoteService extends TypertRemoteService(ctx,'golem')`，`@Remote()` 暴露 6 方法；在 `apply` 注册 |
| 改 | `golem-cordis.yml` | **显式加一行** client 包（发现机制是 patch yml 名单，非自动扫描） |
| 改 | `client 构建` | 借 dsh 的 `node_modules` 解析 `@deepseek-ai/dsh-*` 客户端依赖，预构建 `./client` bundle |
| 退役 | `public/iso-config.html` | 独立页删除（sidecar `GET /config` 页面服务路由一并移除） |
| **保留** | sidecar 配置/实例 REST 路由 | `memory-sidecar.mjs` 的 `/config/default`、`/instance/create`、`/instances/meta`、`PUT /{id}/meta` **保留**——它们现在是服务端 `GolemRemoteService → GolemInstanceApi → AxolotlClient` 的存储后端（维度 I 唯一真相源），并非"平行 REST"。D2a 消除的是"客户端平行直连 sidecar"这层契约，而非 sidecar 本身。原 §4「退役 sidecar REST」判断有误，更正于此。 |
| 回流 | 图库 | `req_iso_config_page → serves → fn_golem_settings_client`；新增 `dec_settings_in_base_panel`；边连到 `dec_isolation_per_instance` |

---

## 5. 风险 / 开放项（动手前必查）

1. **跨仓库 client 构建可行性（D1b，已查实）**：dsh web 构建**不自动扫描** node_modules 或 `packages/client/*`；它枚举 patch yml 的 loader 条目（每条需 `dsh.client.platform:web` + 预构建 `exports["./client"]` bundle）。所以 D1b 可行但须：① client 包是真实 npm 包（有 name + `./client` 导出 + 预构建产物）；② 在 `golem-cordis.yml` **显式加一行**该 client 包；③ 构建时借 dsh 的 `node_modules` 解析 `@deepseek-ai/dsh-*` 客户端依赖。原始设想「放个 raw TS 子目录就自动被拾取」不成立。
2. **`dsh-api-remotes` 扩展机制（D2a，已查实·关键更正）**：`IApiClient`（`connection.api`）**硬编码在 `@deepseek-ai/dsh-host-apiproxy`，不可插件扩展**——加 `IApiClient['golem']` 必须改 dsh 核心，硬阻塞。但另有可扩展通道 **`ctx.remote`**（Typert remote）：服务端 `TypertRemoteService(ctx,'golem')`+`@Remote()`，客户端 `ctx.remote.$mount` 后得 `ctx.remote.golem.*`，**零核心改动**。→ D2a 落地机制改为 `ctx.remote.golem`，非 `IApiClient['golem']`。
3. **设置面板上下文适配**：`settings.section` 组件拿到的是 dsh runtime 上下文（session/workspace observable），与当前独立页"裸 fetch"不同，组件需适配数据获取与提交方式。
4. **与"不 patch dsh 核心"张力的再平衡**：D1b+D2a 最贴合初衷，但都要求先验证 dsh 侧的扩展点确实可用、不改动 dsh 核心包。若验证失败，退路是 D1a/D2b（接受局部 patch / 平行 REST 补齐）。

---

## 6. 分阶段

1. **先查实两个开放项**：D1b 跨仓库 client 构建可行性 + `dsh-api-remotes` 扩展机制（读该包确凿契约）。
2. 定稿本设计文档（你审，确认 D1/D2）。
3. 服务端暴露 `instances` service（含单测）。
4. 客户端包注册 `settings.section` + UI（复用现有交互逻辑）。
5. 接 `golem-cordis.yml`，dsh web 构建验证 section 出现。
6. 退役旧路径 + 图库回流 + 提交。

---

## 7. 已拍板 / 待你确认

- ✅ **D1 = D1b**：客户端包放进 golem 仓库（不 patch dsh 核心）。
- ✅ **D2 = D2a（机制更正为 `ctx.remote.golem`）**：数据走可扩展的 dsh remote 通道（根除平行 REST），**不走 `IApiClient`（不可扩展、需改核心）**。
- ✅ **已查实（2026-08-27 探 dsh 源码）**：§5-1 跨仓库 client 构建可行但须显式 patch yml 行+预构建 `./client`+借 dsh node_modules 解析；§5-2 `IApiClient` 不可扩展，改用 `ctx.remote.golem`。
- ✅ 项目改名已完成（golem），本文档标识符已统一。

## 8. 查实后更正摘要（2026-08-27 探 /tmp/dsh-src 源码）
- **更正 1（D2a 机制）**：原设想 `IApiClient['golem']` 不可行（硬编码在 dsh-host-apiproxy）。改用 `ctx.remote.golem`（Typert remote，可扩展、零核心改动）。
- **更正 2（D1b 发现机制）**：dsh web 不自动扫描 node_modules/工作区；client 包须真实 npm 包 + 预构建 `exports["./client"]` + patch yml **显式加行**。
- **不变的目标**：配置页进基座设置面板（settings.section）、数据走 dsh seam/remote（根除 sidecar 平行 REST）、不 patch dsh 核心。D1b+D2a 在更正后仍可达成。

## 9. 实现期更正（2026-08-27 落地时）
- **更正 3（sidecar REST 去留）**：原 §4 计划「退役 sidecar 配置 REST 路由」**不成立**。D2a 落地后，服务端 `GolemRemoteService` 经 `GolemInstanceApi`/`InstanceRegistry` 调用 `AxolotlClient`，**仍走同一套 sidecar REST**（`/instance/create`、`/{id}/meta`、`/instances/meta`、`/config/default`）作为维度 I 存储后端。所以退役的只有**客户端平行直连的那层**：`public/iso-config.html` + sidecar `GET /config` 页面路由。sidecar REST 本身保留，且不再有任何客户端直连它（平行契约已根除）。
