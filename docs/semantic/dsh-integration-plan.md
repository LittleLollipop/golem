# dsh 集成验证方案（P0 · #18）

> 状态：**方案待评审**。实现（含 dsh-shaped mock 集成测试）在评审通过后再动手。
> 关联：`base-analysis.md` §2（dsh 接缝证据）、`architecture.md` §3（插件装配）、任务清单 #18。

## 1. 目标

验证 `golem` 在**真实 dsh 运行时**中能加载并跑通核心链路。当前状态：代码仅对 `cordis-shim.d.ts` 类型桩**编译通过**，**从未在真实 dsh 中加载运行过**。也就是说，所有"运行时行为"假设都还是纸面推论。

## 2. 当前未验证的接缝（风险点）

| # | 接缝 | 我们的假设 | 未验证风险 |
|---|------|-----------|-----------|
| S1 | `agent/pre-step` | dsh 每个 turn 前调用我们的 listener，且返回的 messages 真的拼进模型上下文 | listener 签名/调用时机不符 → 渗漏块永不注入 |
| S2 | `runIdle` / `whenIdle` | 空闲时触发 `idleMaintenance`（consolidate + perceive） | 不触发 → Plan B 衰减/情境重感知永不跑 |
| S3 | `sessionPersistence.load()` | 返回原始事件，形状 `{type, timestamp, payload.text}` 如 `base-analysis` 假设 | 字段名不符 → `syncLatestTurn` 取不到 user/assistant 文本 |
| S4 | RealHistoryCursor 骑 sessionPersistence | `load()` 即可拿到全量历史（含跨会话） | 若需其他 API → 漂移种子拿不到 |
| S5 | `storageDomain` get/set | 跨进程重启持久 | 不持久 → **跨会话全量漂移（维度 I）不成立** |
| S6 | cordis `apply()` + `inject` 数组 | dsh 按 `inject` 名注入服务，调用 `apply(ctx, config)` | 注入名不符 → `apply` 拿不到 `sessionPersistence` 等 |

## 3. 验证策略（两条路）

### A 路 · dsh-shaped Mock（无运行时，可现在做）
- 实现一个 **dsh 形状的内存 mock**：满足 `DshContext` 全部 seam（`agent.on('pre-step')` / `runMaintenance` / `whenIdle` / `sessionPersistence.list/load` / `storageDomain.get/set` / `invariants.register`）。
- 写**集成测试**加载 `apply(mockCtx)`，然后：
  - 触发 pre-step 事件 → 断言 `assemble()` 被调用、返回 messages 含渗漏块、且按 grade 路由了正确通道；
  - 触发 runMaintenance → 断言 `consolidate` 被调用；
  - 预置 sessionPersistence 事件 → 断言 `syncLatestTurn` 正确消费 `payload.text`。
- **能抓到的 bug**：接线逻辑类（S1/S2/S3/S6 的"调用/消费"是否正确）。
- **抓不到的 bug**：dsh *真实行为* 偏差（S4/S5 的"真实持久/全量"语义、S1 的"模型真的看到渗漏块"）。

### B 路 · 真实 dsh 运行时（需环境）
- 在装有 dsh 的环境：起 harness + 加载 golem 插件。
- 发一条消息 → 观察模型上下文是否含渗漏块（S1）；
- 空闲观察 consolidate 是否被调用（S2）；
- 重启 dsh → 验证实例图仍在、跨会话漂移全量（S5/S4）；
- 确认 `inject` 服务名与 dsh 实际一致（S6）。
- **这是唯一能闭合全部 6 个接缝的路径。**

## 4. Pass 标准（每条对应接缝）

1. pre-step 触发后模型可见消息含「假人潜意识渗漏」块，且 zero 级含 drift+recall+situational 三类贡献；
2. idle 阶段 `consolidate` 被调用且返回报告；
3. `syncLatestTurn` 从 sessionPersistence 正确抽取 user/assistant 文本写入图；
4. `storageDomain` 写入的实例绑定在"重启"后仍在（A 路用 mock 模拟重启；B 路真重启）；
5. cordis `apply` 成功拿到全部注入服务、无 undefined。

## 5. 当前阻塞

**本地无 dsh 运行时**（已探测：`node_modules` 无 dsh 包、全局无、WorkBuddy/dev 下无 dsh checkout；仅 `cordis` 框架在）。因此：
- **B 路需要你提供 dsh 环境**（或告诉我 dsh 的安装/启动方式）；
- **A 路可现在做**，作为"近似集成"安全网，不依赖运行时。

## 6. 建议下一步

评审通过后，我建议**先做 A 路**（dsh mock + 集成测试）立即闭合"接线逻辑"类风险，并把 mock 作为长期回归测试留在 `tests/`；**B 路**等 dsh 环境就绪再跑真验证。

> 注意：A 路通过的"绿"不等于"dsh 真能跑"——它只证明代码内部的接线是对的。最终保真度仍取决于 B 路。
