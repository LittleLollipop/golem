# 假人 (FakeRen) · 实现说明（阶段三落地）

> 评审通过后由 WorkBuddy 直接写码（`dec_code_workbuddy`）。本文件记录**实现态**与运行方式，架构设计见 `architecture.md` / `architecture.html`。

## 关键决策收口（本论次）

- **衰减 = Plan B（停复注 + 留痕）为终态**，`surface` 替换式衰减**彻底不做**（`rejected_surface_replacement`）：用户明确"没有必要做替换"。永久记忆（axolotl 图 + dsh 会话日志）原封不动，低于权重阈值的种子不再被选中注入。`consolidator` 全部逻辑在 sidecar 里跑，不依赖 dsh 上游暴露 surface-append，C3 守住。
- **递归生长 = 保守偶发**（`dec_recursive_growth_conservative`）：`consolidate` 里对高中心性簇按 `GROWTH_PROB=0.15` 低概率偶发抽 `MetaNode`，不每轮跑、不强制。
- **写码分工 = WorkBuddy 直接写**（`dec_code_workbuddy`），不交龙虾。

## 验证结果

| 项 | 结果 |
|---|---|
| TS 类型检查 `tsc --noEmit` | ✅ 零错误（strict + noUnusedLocals/Parameters） |
| sidecar 真 axolotl 后端冒烟 | ✅ 节点/边/recall/crossDomain/consolidate 全部跑通真实 `axolotl_rs` |
| Plan B 衰减触发 | ✅ 40 次 consolidate 后 11 条 decayed（停复注），`stats` 可见 |
| 保守递归生长触发 | ✅ 40 次 consolidate 偶发 8 个 `MetaNode` |
| `/instances` bug（create 后不返回） | ✅ 已修：`ensure()` 强制 `save()` 落盘 + `instances()` 合并内存缓存 |
| 三通道分离（C2） | ✅ drift 只用 `sessionPersistence`(RealHistoryCursor) + `MemoryReader`，代码层无 `sessionQuery` 路径 |

## 文件地图

```
fakeren/
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
│       └── fakeren-agent.ts      # 按 grade 路由三通道 + turn-start 记忆同步 + idle 维护
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

## 未在本次实现（明确范围）

- 真实 LLM 抽取器：当前 `HeuristicExtractor` / `HeuristicValence` 是确定性占位，`req_memory_auto_extract` 的"LLM 复用自身"留作后续替换（接口已留 `Extractor` / `ValenceEstimator` 缝）。
- 图检索后端：`RecallChannel` 默认 `GraphRecallStub`，真实图遍历后端（接 `MemoryReader.recall`）后续替换。
- dsh 运行时集成：本环境无 dsh 运行实例，集成需在 dsh 侧加载插件验证（代码与 seam 契约已对齐 base-analysis 源码核验结论）。
