# Changelog

本项目所有重要变更均记录于此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

两个主题：**漂移种子池去重对称化**。诊断与全部实测数据见 `docs/leak-seed-pool.md`。

⚠️ **破坏性变更**：移除 `FAKEREN_LEAK_MIN_VALENCE` / `minValence`。
该门槛从未生效过——跨域边上没有 `valence` 字段，`props.valence` 全为 `None`，
`minValence` 默认 0 且门槛恒不触发，留着只会误导下一次排查。

### Fixed
- **旧知识每轮刷屏（用户报告："始终在漏相同的东西"）**：`crossDomain` 通道
  **完全没有去重**，sidecar 又按插入序（=时间正序）返回，`slice(0,3)` 让最老的
  3 条边拿到永久席位 —— 实测普雷斯顿 / 科索沃各漏 **20/40 轮**。改为冷却闸门
  （10 轮或 30 分钟，取先到）+ 无放回加权轮转。
- **新知识一次即死（用户报告："没把最近新学的漏出来"）**：L0.5 的
  `sessionLeaked` 是**永久**排除 —— 楠塔哈拉 / 忙哥帖木儿 / 凯耶达尔各漏 1 次后，
  分别静默 67 / 17 / 3 轮。知识因此再也进不了假人的嘴 → 抽取器扫不到 → 入不了图 →
  永远进不了唯一无去重的 crossDomain，自我锁死。改为 **6h 冷却窗口**。
  ⚠️ 冷却不能取 24h：`l05FreshDays=1`，24h 冷却套在 24h 新鲜窗口里等价于
  "每条知识只漏一次"，是**空修复**（已加用例 `2b` 守卫）。
- **往昔回放每轮做一次注定失败的调用**：live 会话下 `loadSessionEvents` 必然
  `catch → []`，`gather` 却每轮调它。改为显式跳过当前会话（只回放已关闭会话），
  并把跳过数记进 `histSkipped` —— 日志里的 `hist=0` 现在能被解释，而不是看起来
  像"这个人没有过去"。
- **本会话刚聊过的边被当成"想起来"漏回来**（Q1 结论）：`crossdomain_weak` 这个
  类型本身可以漏，但漏的目标是**以前会话加的节点**——本会话刚抽出来的边应被排除。
  给 `GraphEdge` 加 `sessionId?`（`golem-agent.syncLatestTurn` 本就持有、只是没往下
  传），sidecar 存进 `_edges` manifest 并透出（缺失时整个 key 不输出，而非 `null`，
  避免"没标记"被误读成"某会话"），`gather` 里 `edge.sessionId === 当前 sessionId →
  skip`，剔除数记 `xdSameSession`。实测本次会话新增只占 6/69≈8.7%，所以它治的是
  **语义正确性**而非刷屏（刷屏靠冷却+轮转）——两者作用面不同，不能互相替代。

### Added
- **`LeakCooldown`（`src/leak/cooldown.ts`）**：两条通道共用的冷却实现，
  由 `DriftChannel` 注入 `L05Trajectory`。同一条要求（2026-08-29「同一个会话里
  相同的记忆不需要反复的漏」）过去在 crossDomain 上**完全缺失**、在 L0.5 上
  **过度实现**（一次即死）—— 共用一张表是防止它再次漂移的结构性保证。
- **加权轮转**：`weight = edge.weight × (1 + 静默轮数/冷却轮数) × rng()`。
  原计划的 `exp(-(now-edge.createdAt)/τ)` 算不出来（边上无时间戳，且不动
  sidecar 存储结构），改用"静默了多少轮"——效果一致且更强：直接奖励没漏过的边，
  而新知识进池后正是没漏过的边。
- **溯源串可读化**：`crossDomain by |valence| rank N` →
  `crossDomain weighted-rotate (w=0.42, idle=new)`（rank 恒等于插入顺序、
  valence 恒为 0，原串是纯噪声）。
- 25 条回归用例（`tests/leak-cooldown.test.ts`），全部确定性（RNG 与时钟均可注入）。
  另加 `tests/writer.test.ts` 2 条契约用例，锁死 `sessionId` 从 `TurnInput` 一路透传到边。
  变异验证：跨域冷却归零 → 5 例红；L0.5 冷却改 24h → 4 例红；去掉 live 过滤 → 3 例红；
  取消会话排除 → 3 例红；缺失字段反转为排除 → 8 例红。

## [0.5.0] - 2026-09-01

两个主题：**人设分层（core/ext）** 与 **三层人格坐标系（HEXACO 基线 + 重力回弹）**。
设计文档见 `docs/persona-layering.md` 与 `docs/persona-drift-dimensions.md`。

⚠️ **破坏性变更**：`FAKEREN_DRIFT_DIMS` 默认值从旧五维
`openness,warmth,verbosity,playfulness,assertiveness` 换成
`extraversion,agreeableness,openness,emotionality,verbosity,playfulness`。
已有的 v1 drift 节点不删除、但**不再参与累积计算**（靠 drift 节点的
`schemaVersion: 2` 过滤，旧节点无此字段）——累积偏移归零重启。

### Added

**人设分层（core / ext）**
- **常驻 core + 图库 ext 分层**：`persona` 单字段拆成 `personaCore`（身份锚 + 红线 + 维度基线 + 护栏指令，每 session 注入）与 `personaExt`（背景/关系/偏好/事件，seed 进 axolotl 图、靠 recall 拉取）。落地：`resolveCorePersona(core > persona > fallback)` + `PersonaSeed`（幂等 seed，连 `persona-identity` 锚）+ `writePersonaExt`（复用抽取管线）+ `loadPersonaLayerConfig`（env 可调）。**铁律：红线 / 身份 / 基线绝不进 recall 路径。**
- **设置面板人格双栏编辑**：原单 textarea 改为 core / ext 双栏，保存走 `setInstanceMeta({personaCore, personaExt})` 并回读校验——旧按钮只写 `persona` 单字段，前端无分层入口。

**三层人格坐标系**
- **Trait 层人格坐标**（`TraitBaseline`）：HEXACO 六维（H/E/X/A/C/O）静态坐标，每假人标一次；兼作每日漂移的**重力中心**（回弹目标）。可用 LLM 从核心人设推断（新增 `inferTraitBaseline` remote），也可在设置面板拖六滑块。
- **重力回弹**（`revertPull`）：软带（0.4）内弱回弹，超出后系数按偏离量放大 → 即使模型天天给满增量，累积也稳定在基线 ±0.5 附近，不再单调撞边界。回弹目标与回弹量写入 drift 节点 `props.traitTarget` / `props.revertPull`，可审计。
- **per-dim 单日上限**（`FAKEREN_DRIFT_DIM_CAPS`）：`emotionality` 默认收紧到 0.08（其它维 0.15），避免"今天心情不好"被记成"性格变敏感了"。
- **维度定义下发**（`getDriftDims` remote）：前端不再硬编码维度名与中文标签，后端为单一真源。
- **人格坐标面板**：内省记录页新增 HEXACO 六维坐标条（灰点=基线 / 彩条=当前偏移）。H、C 两维**灰显**并注明"仅作人格坐标，不参与每日漂移"——它们在闲聊文本中不可观测，强行打分只会变噪声。

### Changed
- **每轮 `memory_recall` 上限 3 → 6**：分层后人设 ext 走 recall 路径，3 条不够用（分层前的设定本就在 system prompt 里，不占 recall 额度）。
- **维度定义改由后端下发**：前端曾把维度名与中文标签写死（`DriftDashboard.tsx`），维度一改 UI 立即对不上（新维度渲染成裸 key）。

### Fixed
- **内省记录 tab 白屏**：`SKIP_TEXT` 声明为 `Record<string, string>` 却混放了函数与字符串，调用侧统一写 `SKIP_TEXT[r.skipReason]?.(r)` → 渲染 `no-dialogue` / `no-llm` / `model-empty` 时**对字符串做调用**，抛 `TypeError` 崩掉整个设置面板（实测：王梗梗 idle 期间攒了 21 条 `no-dialogue` 记录，点开即白屏）。修复：值统一为函数；并加 `TabErrorBoundary` 隔离单个 tab，渲染异常不再拖垮整页且无提示。
- **evidence 悬空边**（实测缺陷）：提示词要求节点 id 却没把 id 喂给模型 → 模型只能编，导致 `relates` 边 100% 指向不存在的节点，而 UI 上"evidence 边 N"的计数却在涨（追溯能力实际为 0）。修复：对话/记忆上下文带上 `[节点 id]`、evidence 改为 `{nodeId, quote}` 结构、**建边前校验节点存在**，悬空的记 `evidenceSkipped` 而不建边。
- **提示词系统性正向偏置**：实测 08-31 与 09-01 的 dims 向量逐字节相同、累积单调不回头（playfulness 7 天撞满 ±1.0）。修复：把各维度"当前已偏离基线的量"喂给模型，并明确要求无新证据时输出 0、性格不会每天都变；同时切割 `mood`（今日心境）与 `emotionality`（情绪底色）。
- **维度共线**：为六个维度给出互斥的操作定义并写进提示词（extraversion 测"主不主动"、verbosity 测"说了多少字"），避免同一信号被计两遍。

### Added（工程）
- **remote 契约测试**（`tests/remote-contract.test.ts`，28 例）：锁死「服务端 `@Remote` 表面」与「客户端 descriptor」的一致性。此前两边**没有任何自动化校验**，而失败模式是静默的：strict zod codec 会**无报错丢弃** schema 里没写的字段（personaCore/personaExt 一次、traitBaseline 又一次）、wire 键按编译后形参名匹配（改名即静默 undefined）、方法集合漂移（调用落到 undefined）。覆盖：方法集合双向相等、每方法 wire 键 == 服务端形参名、所有 codec 必须 strict、InstanceMeta / DriftExecutionResult 全字段在 schema 中、`getDriftDims` 载荷结构与 HEXACO 键枚举。**已做变异验证**（删一个字段 → 4 例红；改一个 wire 键 → 1 例红），确认断言不是装饰。
- **人设分层测试**（`tests/persona-layering.test.ts`，7 例）：core/ext 解析优先级、seed 幂等、ext 写入走抽取管线、config env 覆盖。

## [0.4.1] - 2026-08-30

知识记录可视化、图数据库选型论述，以及 README 文档完善（含「小静」渲染版合并）。

### Added
- **知识记录 dsh 内部标签页**（`client/ui-golem-config/src/KnowledgeDashboard.tsx`）：复用「假人」设置面板新增「知识记录」标签页，从 ledger 读取 `LearnedFact` 展示渠道/状态/摘要，5s 自动刷新；数据经 `getKnowledgeRecords` remote 通道（`src/knowledge/ledger-read.ts` + `src/golem-remote.ts` + `client/ui-golem-remote` descriptor）读取。
- **图数据库选型论述**：`docs/ambient-leakage-framework.md` 新增 §7.1（长程注意力根本矛盾——为什么必须图数据库）与 §7.2（与分层记忆比对：分层=结构预设、链路固定的有界深度 DAG，上限在关系拓扑）；配套 `docs/figures/tiered-vs-graph.svg` 拓扑对照图；README 加「记忆基底：为什么必须是图数据库」缩略版 + 图示跳转。

### Fixed
- **知识获取每日闸门容错**（`src/knowledge/daily-tracker.ts`）：目的轨在无 LLM（`planner` 缺失）时不再把"无规划空尝试"记成已完成、空消耗每日闸门；`!planner` 不写记录不占槽。`scripts/dev-up.sh` 自动从 `~/.dsh/.credentials.yaml` 提取并注入 `DEEPSEEK_API_KEY`，修复 dsh 启动未注入 key 导致新闻/社交抓取无记录的问题。

### Changed
- **README 增补两点定位**：① 假人在了解足够信息后可替代绝大多数工作流（理论定位）；② 性格漂移（自省）说明 + 人机恋警示。
- **性格漂移目的补充**：新增第二条根本目的——通过分析近期历史微调性格，自然生长出最契合用户的假人性格。
- **合并「小静」渲染版 README**（`fr/README.md`）：采纳其润色（如"既多又少""真实史为基质""捏造（fabricated）"表述 + demo 文档链接），并强制保留署名声明句；同步 `demo-baseline-vs-golem.md` 素材。

## [0.4.0] - 2026-08-30

性格漂移（persona-drift）：让假人通过每日一次的内省任务，基于近期记忆与对话自动微调「性格方向」，日积月累形成性格缓慢漂移。

### Added
- **性格漂移服务**（`src/agent/persona-drift.ts`）：每日（跨日后首次 idle）读取近期对话(`assistantSummary`)+记忆+历史 drift 链，调用宿主 LLM 产出**结构化维度偏移**；持久化为 `Event` 节点(`props.kind="persona_drift"`)，并用 `causal` 边串成演进链、`relates` 边连支撑证据。
- **effective persona 合成**：`composeEffectivePersona(base, instanceId)` 读图取最新累积偏移，把维度翻译成自然语言倾向追加到 base 之后（base 永不被改写，仅追加 `【近期性格倾向】` 段）。`index.ts` 的 pre-step 注入点改用 effective persona。
- **配置外置**（`src/leak/config.ts` 的 `PersonaDriftConfig` + `loadPersonaDriftConfig`）：`FAKEREN_DRIFT_ENABLED`(默认开)/`DAILY_CAP`(0.15)/`CLAMP`(1.0)/`RECENT_DAYS`(7)/`HISTORY_DAYS`(14)/`DIMS`(5 维)/`REPORT_DIR`(默认 `~/.fakeren/drift-reports`)。
- **内省可见性**（`src/agent/drift-reporter.ts` 新增 `DriftReporter` 接口 + `FileDriftReporter`）：每次内省结果落盘为 append-only JSONL（`<inst>.drift-records.jsonl`）+ 易读 `.drift-log.md` + `.last.json`，并打 `[golem:drift]` 日志（✅ 成功 / ⚠️ 跳过 / ⏭️ 无记录），消除黑盒。
- **dsh 内部「内省记录」仪表盘**（`client/ui-golem-config/src/DriftDashboard.tsx`）：复用 golem 现有 settings「假人」面板，新增「内省记录」标签页，时间线展示历次内省的维度偏移与支撑证据，5s 自动刷新；数据经 `getDriftRecords` remote 通道（`src/golem-remote.ts` + `client/ui-golem-remote` descriptor）从 JSONL 读取。

### 设计决策（§12 开放问题已决）
- **Q1 去重**：不引入额外状态文件，直接查图「今日是否已有 `persona_drift` 节点」——演进链本身即真相，规避 D1「记忆走 axolotl 唯一」铁律张力。
- **Q2 合成**：方案 A（base 全文 + 追加倾向描述），保持 `channel="persona"` 每 session 注入一次不变。
- **Q3 无对话**：跳过当天（演进链断档），断档本身有信息量。
- **base 不可变**：LLM 输出中任何非维度字段（如企图改写 persona）一律丢弃；单日增量 clamp ±0.15，累积 clamp ±1.0，越界拒绝本次 drift。

### Changed
- idle 维护链（`index.ts:runIdle`）新增 `personaDrift.introspect`（在 `l05.tick` 之后、`idleMaintenance` 之前）；pre-step persona 来源由 base 改为 effective。
- `index.ts` 构造时注入 `FileDriftReporter`；`readDriftRecords(instanceId, cfg)` 导出供 remote 通道读取。

### 测试
- 新增 `tests/persona-drift.test.ts`（9 用例）：无 drift→base 原样、有 drift→追加倾向、累积 clamp、按日历日幂等、无 LLM 跳过、无对话跳过、happy path 写节点+causal+relates 边、单日增量 clamp、丢弃非维度字段。

## [0.3.0] - 2026-08-29

假人 dsh 插件：自记忆（axolotl 图后端）驱动的潜意识渗漏（L0/L0.5/L1）。本版聚焦**记忆召回质量**与**跨重启持久化**。

### Added
- **双机制记忆检索**（`feat(memory)`）：召回分两层 —— A. 每回合自动注入的「指针(push-hint)」只提示相关记忆的标签，不刷全文；B. 模型主动调用 `memory_recall` 工具拉取完整节点。两条路都走真实 axolotl 图后端。
- **召回相关性排序**（`fix(recall)`）：`rankNodes()` 按「标签命中数×10 + 特异度×1.5 + 覆盖×1」排序（再 weight→timestamp 兜底），点名记忆不再被 `slice` 切掉。
- **二跳扩展**（`fix(recall)`）：取 top-3 锚点的 1-hop 邻居插入锚点之后（集群聚合顶部），让相关上下文优先露出，2-hop 项标注 provenance；新增 `neighbors` 接口贯通（sidecar `POST /{inst}/neighbors` + `GraphStore`/`axolotl-client`/`reader` 各层）。
- **记忆-first 默认行为**（`fix(recall)`）：每回合 step-1 注入 `MEMORY_FIRST_DIRECTIVE` 操作指令 —— 「先调 `memory_recall` 再查外部（文件系统/Grep 等）」，从根上纠正模型直接 grep 文件的偏离；`memory-recall.ts` 描述同步强化护栏。

### Changed
- **L0.5 知识泄漏**（`fix(leak)`）：由「抖全文」改为关键词指针式泄漏，并新增同会话去重（不重复漏同一条），加新鲜度闸门（默认 1 天，超龄退出自动漏），不再每轮刷屏式复读。
- **潜意识渗漏注入时机**（`fix(seams)`）：工具循环轮（step≥2）不再注入渗漏，也不再调用 `assemble`，降低干扰。

### Fixed
- **记忆持久化 bug（隐藏根因）**（`fix(recall)` + `sidecar/server.py`）：`add_node`/`add_edge` 写完未 `save()`，sidecar 重启会丢失最近写入节点（含部分记忆）。现已每次写入即落盘，数据跨重启不丢。
- **`memory_recall` schema**（`fix(memory_recall)`）：`parameters` 改为 object-rooted JSON Schema，避免 dsh 校验拒绝注册。
- **dev-up 跨平台后台脱离**（`fix(dev-up)`）：macOS 无 `setsid` 时退回 `nohup+disown`。

### 验证
- `npm run build` 零错；`vitest` 179 全绿（含新增 golem-agent / recall-channel 二跳与排序用例）。
- 模拟 `pointers("卷一·不嫁 写大纲")` → 该节点排 #1，二跳拉出钟无艳/梗概/节拍并聚合顶部。
- 持久化 kill 测试：写入后杀 sidecar 重启，节点仍在（修复前必丢）。

## [0.2.0] - 2026-08-29

首个打 tag 的发布（commit `2f3ee71`）。覆盖自初始架构提交 `1c9e2fa`（2026-08-24）起的 39 个 commit，建立假人完整的潜意识渗漏 + 自记忆 + 知识学习骨架，并完成 dsh 真集成、设置面板与开源准备。

### Added
- **多假人隔离语义记忆架构**（初始提交 `1c9e2fa`，"fakeren v0.1"）：per-instance 独立记忆图，自记忆基石。
- **dsh 真集成接缝**：事件式接入（`678a83e` fix P0/#18）、`pre-step` 钩子接入实例元数据并下沉 axolotl 基板（`23971a4`）、运行时不再加载 live session（`f970480`）、observability 日志落盘（`acb571d`）。
- **Recall 图检索通道**（`186bbca` feat P0）：接通 axolotl 图检索；recall 通道 surface 助手回复摘要（`6bb647a`），drift「往昔」surface 历史助手回复并剥离模型思考（`f881452`）；注入消息加 UI 标记（`999d220`）。
- **渗漏框架 L0/L0.5/L1**：结构注入标记 + LLM 抽取/valence/评分 seams + per-instance persona + CLI（`db16e27` P1-P5），并据设计对齐（`deedb77`）；ambient 运行时开关（`a929723` #47）、流滚动衰减（`c3f6c03` #46）、采集白名单 + 摄像头/麦克风独立开关（`8690fd0` #48）、摄像头/麦克风真实感官接入（`f89ea23` #45）、ambient 异步预算（`baaa859` #49）、后台 daemon 资源占用可控（`89fb48b` #50）。
- **L0.5 每日知识轨迹**（`844af62` #51）+ 执行时后筛双候选（`19a76ee` #52）+ leak 参数外置可调（`a1b2432` #53）+ 输出级污染归因（`0e79514` #54）+ 种子溯源（`7096d8a` #55）+ 检视 CLI（`58c44c3` #56）+ 悬置需求备案（`68203d9` #57）+ 后台调度运行日志（`6db0533` #58）。
- **双轨知识学习**（`f94c20c` l05）：随机机械轨 + 模型驱动目的轨（抽象状态、不兜底）；知识源实时拉取 Wikipedia（`00fb0fb`）、新增 News(RSS) 与 Social(HN 热榜)（`6cbecb2`），并按源切换模式策略（`69ffaf7`）。
- **配置页迁移进 dsh 设置面板**（`92fa3d7` D1b+D2a），并闭环 + 开源准备 / 框架论述 / README，命名弃用 Fake Human（`c4f386b`）。
- **项目重命名** `fakeren → golem`（`dc7406f`），含客户端包双-half 结构修复（`8fcc0a8`/`8b5a3d2`）。
- **dev-up 常驻**：dsh web 常驻 + 首个假人「小静」(遗思静) 撰写/润色的 README 与演示素材（`c5f46b0`）。

### Changed
- 潜意识渗漏注入策略迭代：`setDefaultInstance` 返回 `null` 替代 `undefined` 消除 RemoteResult 边界校验失败（`7b165a6`），并补类型签名对齐（`d22d04a`）。
- 工具循环轮（step≥2）不再注入渗漏、不再调用 `assemble`（`1230ffe` fix seams）。

### Fixed
- `session event 'user/message'` 携带非 JSON 可序列化数据（`bf57bfa`）。
- recall/grader/sync 中文 grader 正则、always-on recall、注入消息不进记忆图（`13511f6`）。
- dev-up 跨平台后台脱离，macOS 无 `setsid` 时退回 `nohup+disown`（`b92192e`）。

## [0.1.0] - 2026-08-24

- 初始提交（`1c9e2fa`）：假人多假人隔离语义记忆架构实现。作为本项目的基石，后续 v0.2.0 的全部功能均在此基础上构建。

[0.3.0]: https://github.com/LittleLollipop/golem/releases/tag/v0.3.0
[0.2.0]: https://github.com/LittleLollipop/golem/releases/tag/v0.2.0
