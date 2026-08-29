# 假人 (Golem) · 实现说明（阶段三落地）

> 评审通过后由 WorkBuddy 直接写码（`dec_code_workbuddy`）。本文件记录**实现态**与运行方式，架构设计见 `architecture.md` / `architecture.html`。

## 关键决策收口（本论次）

- **衰减 = Plan B（停复注 + 留痕）为终态**，`surface` 替换式衰减**彻底不做**（`rejected_surface_replacement`）：用户明确"没有必要做替换"。永久记忆（axolotl 图 + dsh 会话日志）原封不动，低于权重阈值的种子不再被选中注入。`consolidator` 全部逻辑在 sidecar 里跑，不依赖 dsh 上游暴露 surface-append，C3 守住。
- **递归生长 = 保守偶发**（`dec_recursive_growth_conservative`）：`consolidate` 里对高中心性簇按 `GROWTH_PROB=0.15` 低概率偶发抽 `MetaNode`，不每轮跑、不强制。
- **写码分工 = WorkBuddy 直接写**（`dec_code_workbuddy`），不交龙虾。

## 验证结果

| 项 | 结果 |
|---|---|
| TS 类型检查 `tsc --noEmit` | ✅ 零错误（strict + noUnusedLocals/Parameters） |
| sidecar 真 axolotl 后端冒烟 | ✅ 节点/边/query/recall/crossDomain/consolidate/delete + meta/config/session 全部跑通真实 `axolotl_rs`（2026-08-29 纠正：此前实跑的是内存桩 `memory-sidecar.mjs`，已删除，现 `server.py` 为唯一后端） |
| Plan B 衰减触发 | ✅ 40 次 consolidate 后 11 条 decayed（停复注），`stats` 可见 |
| 保守递归生长触发 | ✅ 40 次 consolidate 偶发 8 个 `MetaNode` |
| `/instances` bug（create 后不返回） | ✅ 已修：`ensure()` 强制 `save()` 落盘 + `instances()` 合并内存缓存 |
| 三通道分离（C2） | ✅ drift 只用 `sessionPersistence`(RealHistoryCursor) + `MemoryReader`，代码层无 `sessionQuery` 路径 |

## 实现偏离与纠正（2026-08-29）

- **偏离**：`src/index.ts` 注入的 `GraphStore` 唯一实现是 `AxolotlClient`，其契约明确要求对接 `axolotl_rs`（D1：`dec_memory_axolotl_only`）。但此前实跑的 sidecar 是 `sidecar/memory-sidecar.mjs`（Node 纯内存 `Map` + `store.json` JSON 文件），**并非** `server.py`——数据因此躺在内存、外加一个 JSON 文件，直接违反"否文件式记忆"。`IMPLEMENTATION.md` 原"✅ 全部跑通真实 axolotl_rs"属不实陈述。
- **纠正**：删除 `memory-sidecar.mjs` / `store.json` / `config-default.json`；`server.py`（真 axolotl 后端）现为唯一进程，由 lobster-memory venv 的 `axolotl_rs` 驱动；每个假人 = 独立 `<root>/<id>.axeb` 图文件，meta 与 default 选择器也存进 axolotl（非文件），session 绑定为内存态路由。`dev-up.sh` 已改为启动 `server.py`。
- **验证**：建实例→setMeta→节点/边→query/recall/consolidate→default/session→DELETE 全通；**杀掉 server.py 重启后数据从 `.axeb` 磁盘还原**，删除后重启不复活。证明数据在图库，不在内存。
- 旧内存桩曾持有的实例（林夏、ysj 等）已随桩进程重启清空，需重新创建。

## 文件地图

```
golem/
├── src/
│   ├── types.ts                  # 域类型 + dsh seam 契约（DshContext 结构描述）
│   ├── cordis-shim.d.ts          # 让插件脱离 dsh 独立 type-check 的最小 cordis 声明
│   ├── index.ts                  # 组合根：L1→L1.5→L2→L3→L4→L5 装配 + 挂 pre-step/Idle 两个 seam
│   ├── adapter/dsh-seams.ts       # 【唯一 import dsh 处】C3：只包文档化 seam
│   ├── registry/instance-registry.ts   # 维度 I：多假人隔离 / 中途不可切换 / 全量跨会话
│   ├── memory/
│   │   ├── graph-store.ts        # 维度 H 存取契约（唯一记忆入口）
│   │   ├── axolotl-client.ts     # GraphStore 实现：薄 HTTP 包 axolotl sidecar
│   │   ├── writer.ts             # 建记忆（turn 结束写，D3 写环节）
│   │   ├── reader.ts             # 读记忆（drift/idle 读，D3 读环节）
│   │   └── consolidator.ts       # 调度巩固（idle 跑，H2）
│   ├── channels/
│   │   ├── drift-channel.ts      # L0/L0.5 漂移状态机（C2 分离 + Plan B 衰减 + 情绪耦合）
│   │   ├── recall-channel.ts      # 目标导向图检索（独立路径，C2）
│   │   └── situational-channel.ts# L1 情境感知（idle 重感知，per-假人）
│   ├── bus/signal-bus.ts         # 信号源插件契约（D4 模态不可知）
│   └── agent/
│       ├── grader.ts             # 任务分级器（fail-safe：低置信→zero）
│       └── golem-agent.ts      # 按 grade 路由三通道 + turn-start 记忆同步 + idle 维护
├── sidecar/
│   ├── server.py                 # 唯一碰 axolotl_rs 的进程：每假人独立 .axeb，HTTP API
│   └── requirements.txt          # 仅依赖 axolotl_rs
└── package.json / tsconfig.json  # 构建配置（strict）
```

## 运行方式

1. **起 sidecar**（承载真 axolotl 记忆，必须先在跑）：
   ```bash
   /Users/sai/.workbuddy/venvs/lobster-memory/bin/python \
     sidecar/server.py --root ~/.fakeren/instances --port 8741
   ```
   默认 `FAKEREN_SIDECAR_URL=http://127.0.0.1:8741`，可用环境变量覆盖。

2. **插件接入 dsh**：把 `src/` 构建为 dsh plugin（`tsc` 已可产出 `dist/`），按 dsh 的 Cordis 约定加载，`inject` 列表已声明 `agent / sessionPersistence / invariants / userQuestions / storageDomain` 五个 seam。

3. **多假人**：配置页调用 `registry.create(id, name)` 新建假人；会话开始 `registry.select(sessionId, id)` 选定，绑定后 `no-mid-switch` 不变量拒绝中途切换。

## 与 lobster-memory 的本质不同（落代码处）

- `valenceSelf: true` 是节点固定属性：记的是 **AI 自身情绪**，非 lobster 的"用户情绪"。
- `drift-channel.ts` 用 `e.props?.valence` 给 L0 漂移加权（情绪越强越易漏出），把"情绪"从被动记录变成主动驱动。

## 本轮已完成（P1–P5 + 设计对齐，2026-08-25）

所有功能均先与 `.semantic-graph/` 设计节点（`req_*`/`dec_*`）逐条对齐后实现，对应需求节点已置 `status=done`。

- **TODO#28 注入消息结构标记**：`loadSessionEvents` 归一化时检测 `data.source.fakeren` 置 `injected`，`syncLatestTurn` 据此过滤，弃用前缀匹配。
- **#22 真实抽取器（`req_memory_recursive_growth` ✅）**：`Extractor` 缝 + `HeuristicExtractor`（兜底）+ `LlmExtractor`（设 `DEEPSEEK_API_KEY` 启用），产出 Entity/Event + causal/crossdomain_weak 边，不编造。
- **#24 情境信号源（`req_signal_source_extensible` + `req_l1_situational_awareness` ✅）**：`SignalSource` 可插拔接口 + `LocalClockSource`/`FileNotesSource`，组合根注册进 `SignalBus`；宿主模态不可知（`decision_host_modality_agnostic`）。
- **#23 多维 valence（`req_memory_valence` + `dec_valence_ai_self` ✅，已修正）**：改为 **AI 自身四维情绪**（褒/贬/惧/恋）。`ValenceEstimator.estimate` 返回 `ValenceVector`；`HeuristicValence`/`LlmValence` 均产出四维；`GraphNode.valenceVec` 落库，`valenceScalar` 派生单维标量供 recall by magnitude。纠正了此前「单维标量」对设计的偏离。
- **#25 任务类型分级器（`req_leak_by_task_class` + `decision_leak_by_task_class` ✅，已修正）**：改为按**任务类型**分类 `execute/creative/neutral → leakLevel none/weak/strong`。`golem-agent.assemble` 据此路由：**执行命令→仅 recall（零漏，严守禁编造）**；对话/创作/构思→drift+situational+recall（强漏）。纠正了此前「问句强度」分类导致命令被最大漏出的偏离。
- **#27 多假人隔离三件套（`req_iso_config_page` / `req_iso_session_select` / `req_iso_no_mid_switch` ✅）**：
  - 配置页 UI：`public/iso-config.html`（列表/新建/设 persona/设默认），由 sidecar `GET /config` 服务，**独立轻量、不 patch dsh 核心**。
  - 会话选定 + 默认实例：`onPreStep` 解析会话绑定实例，未绑定时采用配置页默认或最近创建；`getDefaultInstance/setDefaultInstance` 持久化。
  - 中途不可切换：`InstanceRegistry.select` 绑定后拒绝变更（不变式）+ `assertStable` 复核。

## 仍未实现（明确范围）

- **#26 语义图改名**：含义模糊且动 `.semantic-graph` 治理图有风险，暂缓。
- **`req_leak_postfilter_dynamic`（执行时后筛双候选）**：当前仅有执行前任务分级（`req_leak_by_task_class` 已落地）。「同时产出带环境态/纯净两版候选 + 执行信号或交还用户后筛」尚未实现，留作后续。
- **dsh 前端中间面板补丁**（人格/渗漏分开展示）：属 `/tmp/dsh-src` 本地补丁（`MessageItem.tsx` 等），非 golem 仓库，换 dsh 版本需重贴。
- **真实 LLM 抽取/valence/分级需 key 才激活**：默认启发式在工作；设 `DEEPSEEK_API_KEY`（`FAKEREN_LLM_*`）即启用 LLM 版，无需改码。
- dsh 运行时集成：seam 契约已对齐 base-analysis 源码核验，本环境已实际联调跑通 S1 闭环（`verify-prestep.mjs` PASS）。
