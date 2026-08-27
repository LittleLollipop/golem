# 把配置页搬进 dsh 基座设置面板（方案设计）

> **状态：提案（待评审）**。评审通过后再实现 + 回流图库。
> 背景：用户选择把 `public/iso-config.html` 从"独立 sidecar 页面"迁移进 dsh 设置面板（选项 B）。

---

## 0. 已查实的事实（来自代码/文档，非推测）

- **当前配置页是独立 static HTML**：`public/iso-config.html`，由 sidecar `GET /config` 服务。设计意图明确写在 `docs/semantic/IMPLEMENTATION.md` L88：*"独立轻量、不 patch dsh 核心"*。
- **golem 是纯服务端 dsh 插件**：`package.json` 无 `"dsh": { "client" }` 声明；`inject = ["sessionPersistence","userQuestions"]`，`apply()` 只接服务端 seam（agent/pre-step、memory/axolotl、instance registry、signal bus）。
- **dsh 前端机制（核实自 `/tmp/dsh-src` 源码）**：
  - 设置页扩展点是 **`settings.section`** slot（非 `settings.page`）。注册形态：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, children }, Comp))`。样例：`packages/client/ui-settings-general/src/client/index.ts:169`。
  - 客户端插件数据通路是 **`@deepseek-ai/dsh-api-remotes/client` 的 typed `IApiClient`**（如 `IApiClient['sessions'].models` / `selectModel`）。样例：`packages/client/ui-model-selection`。
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

- **D2a｜经 dsh seam / remote（正统）**：golem 服务端插件在 `ctx` 暴露一个 service（如 `ctx.golem.instances`：`list / create / getMeta / setMeta / getDefault / setDefault`），客户端经 typed remote 调用。最贴合你原话"对齐 dsh 记忆/runtime seam、不再依赖 sidecar 平行 REST"。
  - ❌ 需扩展 `dsh-api-remotes` 增加 `golem` 名空间（属扩展 dsh 包，需确认契约扩展机制 —— **§5 开放项**）。
- **D2b｜客户端直接 fetch 假人 sidecar REST**：把 `server.py` 缺失的配置接口补齐全后，配置 UI 仍调 sidecar 自有 REST。
  - ✅ 改动小、不碰 `dsh-api-remotes`。
  - ❌ 配置 UI 仍依赖"sidecar 平行 REST"这条契约，只是把它在真后端补齐，未从根上消除平行契约。

> ✅ **已选 D2a**（2026-08-27 用户拍板）：客户端数据走 dsh seam / typed remote，根除 sidecar 平行 REST。前提见 §5-2（`dsh-api-remotes` 扩展机制），动码前必查实。

---

## 3. 目标架构（草图）

```
[server plugin]  AxolotlClient + InstanceRegistry
        │  暴露 instances service（D2a）
        ▼
  ctx.golem.instances  (新 service / remote 名空间)
        │  typed remote（IApiClient['golem']）
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
| 新增 | `client/ui-golem-config/package.json` | 含 `"dsh": { "client": { inject:[...], platform:"web" } }` |
| 新增 | `client/ui-golem-config/src/index.ts` | 注册 `settings.section(id:'golem', label:'假人')` |
| 新增 | `client/ui-golem-config/src/GolemSettings.tsx` | 复用现有交互（列表/新建/设 persona/设默认） |
| 新增 | `src/` instances service | 基于现有 `AxolotlClient`+`InstanceRegistry` 暴露 list/create/getMeta/setMeta/getDefault/setDefault |
| 改 | `golem-cordis.yml` | 增加插入 client 包（D1b）或保持 monorepo 内（D1a） |
| 改 | `dsh-api-remotes`（D2a） | 增加 `golem` 名空间契约 |
| 退役 | `public/iso-config.html` | 独立页删除 |
| 退役 | sidecar 配置 REST 路由 | demo `memory-sidecar.mjs` 的 `/config`、`/instances/meta`、`PUT /{id}/meta` 等（server.py 侧 D2b 才需补，D2a 则一并退役） |
| 回流 | 图库 | `req_iso_config_page → serves → fn_golem_settings_client`；新增 `dec_settings_in_base_panel`；边连到 `dec_isolation_per_instance` |

---

## 5. 风险 / 开放项（动手前必查）

1. **跨仓库 client 构建可行性（D1b 前提）**：dsh web 构建能否解析 `node_modules/golem` 软链下的 `client/*` 子包并打进 bundle。需实测（或确认 dsh 的 client 包发现机制）。
2. **`dsh-api-remotes` 扩展机制（D2a 前提）**：本 checkout 的 `/tmp/dsh-src` 未含该包源码，无法直接读契约。需在 dsh 源码/发布包内确认如何新增一个 `golem` 名空间（declare-merge `IApiClient`？还是独立 exported client？）。
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
- ✅ **D2 = D2a**：数据走 dsh seam / typed remote（根除平行 REST）。
- ⏳ **待查实（动码前）**：§5-1 跨仓库 client 构建可行性、§5-2 `dsh-api-remotes` 扩展机制。
- ⏳ **新议题**：项目改名（见下方对话）——`golem` 半中半英，改名后将统一刷新本文档中的 `golem` 标识符与 `golem-cordis.yml` 的 `id`。
