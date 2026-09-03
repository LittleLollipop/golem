# 漂移种子池：两道闸门与往昔回放（缺陷诊断 + 修复方案）v0.1

> 状态：**待评审**
> 日期：2026-09-03
> 触发：用户实测反馈——「在一个没有关闭的长期会话中，始终在漏相同的东西，并没把最近新学的漏出来」
> 相关：`docs/ambient-leakage-framework.md`（L0/L0.5/L1 与 C2 分离）、`src/channels/drift-channel.ts`、`sidecar/server.py`

---

## 1. 现象与实测证据

诊断不靠推断，全部来自实查（实例 `ysj`，数据源 `/tmp/fakeren-prestep.log` + sidecar `:8741`）：

| 指标 | 实测值 |
|---|---|
| 图规模 | 462 节点 / 817 边 / 178 已衰减 |
| 跨域池边数 | **69** |
| LEAK BLOCK 次数 | **40** |
| 跨域联想**唯一**种子数 | **3**（每条重复 20 次） |
| 今天(09-03)写入的节点数 | **61** |
| 其中进入跨域池的 | **10（16%）** |
| 今天入池的边在池中的**位置** | **35、64、65、66、67、68**（6 条边，涉及上述 10 个节点） |
| 实际被选中的位置 | **0、1、2**（全是 08-30 的老边） |
| 频道贡献 | 跨域联想 65 · 知识轨迹 3 · **往昔回放 0** · **环境流 0** |

重复漏出的就是这三条（`valence` 全为 `None`）：

```
llm_10_普雷斯顿2014-15赛季 ↔ llm_12_上次讨论节拍结构
llm_11_科索沃市镇        ↔ llm_12_上次讨论节拍结构
llm_0_科索沃            ↔ llm_4_科索沃（地名）
```

而今天用户实际在聊的内容（湣王、孟尝君、乐毅、钟无艳、夏迎春 = `llm_26~30`）一次都没漏过。

---

## 2. 核心模型：两道闸门串联

一个节点要被漏出来，必须连过两道闸门，**任何一道不过就出不来**：

```
今天写入 61 个节点
   ↓ 闸门一（准入：PageRank top-3 + 15% 概率）
   10 个进池（16%）           ← 51 个死在这里
   ↓ 闸门二（位置：无排序 + slice(0, 3)）
   排在位置 35~68
   ↓ 实际切片取位置 0~2
   0 个被选中                 ← 10 个又全死在这里
```

**关键推论（决定修复优先级）**：

| 只修哪道 | 效果 |
|---|---|
| **只修闸门二（选择层）** | ✅ **能解决"一直漏相同的"**——池里那 10 个今天的节点有机会被选中。但 84% 的新节点（含最新的 `llm_26~30`）仍永远进不来。 |
| 只修闸门一（准入层） | ❌ **完全无效**——新节点进了池也是 append 到尾部，照样被 `slice(0,3)` 切掉。 |

→ **闸门二是必做项，且单独做就有明显改善。闸门一是增强项，必须和闸门二一起做才有意义。**

---

## 3. 闸门二：选择层 —— 为什么永远漏那 3 条

**`sidecar/server.py:190-197` 的 `cross_domain()` 完全没有排序**：

```python
def cross_domain(self, instance_id, limit=200):
    return [ ... for e in self._edges
             if e["kind"] == "crossdomain_weak" and e["instanceId"] == instance_id ][:limit]
```

返回顺序 = `self._edges` 的**插入顺序**（`add_edge` 是 `self._edges.append(...)`，新边永远追加到尾部）。

**`src/channels/drift-channel.ts:61`** 再取：

```ts
seeds.slice(0, this.leak.driftLimit).forEach((e, rank) => { ... })
```

`driftLimit` 默认 3。每轮 pre-step 重新 `gather()`，`DriftChannel` **无状态**：无跨轮去重、无轮转、无随机。

→ 每轮都是插入顺序的头 3 条，20 轮零变化；新边在尾部，永远够不着。

### 3.1 附带问题：那个 rank 是假的

provenance 字符串写着 `crossDomain by |valence| rank N`，但：

- **所有跨域边的 `props.valence` 都是 `None`** —— `add_edge`（server.py:255）根本没写 props；
- `FAKEREN_LEAK_MIN_VALENCE` 默认 **0**，即门槛关闭。

也就是说 `"by |valence| rank"` 在运行时**恒等于插入顺序**，是个误导性标签。它让排查者以为存在有意义的排序，从而看不出真正的 bug。这与 `docs/persona-drift-dimensions.md` §1.4 的「evidence 悬空边」是同一类问题：**计数/标签在涨，能力为零**。

---

## 4. 闸门一：准入层 —— 为什么最新的那批进不来

跨域边**只在 `consolidate()` 时**生成（server.py:240-256）：

```python
pr = self._g.pagerank(30, 0.85)
top = sorted(pr.items(), key=lambda kv: kv[1], reverse=True)[:3]
if top and random.random() < GROWTH_PROB:   # GROWTH_PROB = 0.15
```

三重限制：**只从 PageRank top-3 挑** → **只有 15% 概率长** → **consolidate 只在 idle 跑**。

实测今天 61 个新节点只有 10 个进池 = **16%**，与 `GROWTH_PROB = 0.15` 高度吻合——**就是这道概率闸门在起作用**，不是巧合。

注意这道闸门**不是完全堵死**：今天的节点确实有进池的（位置 35/64-68）。它的问题是**覆盖率低（16%）且偏向已有的 hub 节点**（PageRank top-3 天然偏好老节点）。最新的 `llm_26~30` 一条边都没有，因为它们是最新写入、连边最少的。

---

## 5. 第三处：往昔回放恒为 0

`src/adapter/dsh-seams.ts:305`：

```ts
try {
  inspection = await ctx.sessionPersistence.load(id);
} catch {
  return [];   // live turn open, or session not found → nothing to read
}
```

pre-step 时当前轮次是 open 的 → `load()` 抛异常 → **静默返回空数组**。回到 drift-channel，`sigIdx = -1` → `continue` → 零贡献、零日志。

日志里从头到尾只有 1 个 session id，就是当前这个长期会话 → 往昔回放**必然恒为 0**。

顺带的性能问题：每轮 pre-step 对每个 recent session 都调一次 `loadSessionEvents()`，而这些调用**必然全部失败**。

（环境流为 0 不是缺陷：camera/mic/native 全部默认关闭，属 opt-in 设计，本轮不动。）

---

## 6. 方案

优先级按 §2 结论：**闸门二先做且必做，闸门一作为增强同批做，往昔回放独立修**。

### 6.1 闸门二：加权轮转 + 会话内冷却

改 `DriftChannel.gather()`，把 `slice(0, driftLimit)` 换成**加权无放回抽样**：

**权重从哪来**（valence 不可用，必须另找）：

```
w(edge) = edge.weight × recency(t)
recency(t) = exp(-(now - t) / τ)        // t = 边两端节点里较新的 timestamp
```

`edge.weight` 建边时已写入（跨域边恒为 0.5），recency 让新边有额外优势。`τ` 可配。

仅靠加权抽样还不够——`llm_26~30` 压根不在池里，加权也救不了。所以还需要**冷却**来强制轮转，让池里的 69 条边都能轮到：

**冷却机制**：

- `DriftChannel` 增加 per-session 状态 `Map<sessionId, Map<seedId, lastTurnSeen>>`
- 用过的 seed 在 `cooldownTurns` 轮内权重 × `cooldownFactor`（**不归零**——归零会在池子小时迅速空转）
- 与 `L05Trajectory.sessionLeaked` 的既有模式保持一致，便于理解

**降级**：池子容量 < `driftLimit` 时返回全部，不报错、不补空。

### 6.2 闸门一：新增独立源「近因回响」（可选增强）

给 drift 增加**第 5 个源**：直接从图里取**最近写入**的 N 个节点，绕开 PageRank 概率闸门。

- 语义：`[近因] 刚发生的事还在脑子里打转` —— 与 `[跨域联想]` 是两回事，不该共用同一个池
- 呈现沿用现有贡献结构，`provenance.selectionPath = "recent write rank N (ts ...)"`

**性能设计（关键）**：不能每轮 walk 全图（`query()` 是 `self._g.walk(ROOT, 4)`，O(N)）。

- sidecar 新增 `POST /{id}/recent?limit=N`（按 timestamp 倒序）
- **每轮不调**：只在 **idle 结束时**调一次，缓存到 per-instance 字段，pre-step 直接读缓存
- 新节点是 idle 时由 `syncLatestTurn` 写入的，idle 末尾刷新恰好能拿到最新的

→ 每轮 pre-step 的额外图查询开销为 **0**。

### 6.3 往昔回放：RealHistoryCursor 改 idle 缓存

引入 per-session 事件缓存，遵守 C2（drift 仍只读 sessionPersistence，不碰 sessionQuery）：

- **idle 时**（turn 已关闭，`load()` 成功）：读取并缓存 events，记 `cachedAt`
- **pre-step 时**：只读缓存，**绝不调 `loadSessionEvents()`**
- 缓存未命中（刚启动、还没跑过 idle）→ 返回空，与现状一致，不恶化

顺带收益：消除每轮必然失败的 `load()` 调用。

### 6.4 溯源诚实性

- `crossDomain by |valence| rank N` → 改为实际依据，如 `weighted sample (w=0.42, recency=0.87, cooldown 0.15)`
- `minValence` 这个配置：目前是死的（边无 valence、默认 0）。**建议删除**，或明确接上节点 valence（见 §9 Q3）

---

## 7. 配置开关（全部外置，遵循 req_leak_rate_tunable）

| env | 默认 | 说明 |
|---|---|---|
| `FAKEREN_LEAK_ROTATE` | `1` | 0 → 退化为旧的确定性 slice（便于 A/B 对比） |
| `FAKEREN_LEAK_COOLDOWN_TURNS` | `6` | 种子冷却轮数 |
| `FAKEREN_LEAK_COOLDOWN_FACTOR` | `0.15` | 冷却期内权重乘数（>0 防空转） |
| `FAKEREN_LEAK_RECENCY_TAU_MS` | `172800000` | recency 时间常数（默认 2 天） |
| `FAKEREN_LEAK_RECENT_LIMIT` | `2` | 近因回响源条数（0 = 关闭该源） |
| `FAKEREN_LEAK_RECENT_MAX_AGE_MS` | `259200000` | 近因回响的最大年龄（默认 3 天） |

---

## 8. 测试用例（业务层）

沿用「做完再测」约定，整批实现完成后一次性跑。

**闸门二（选择层）**
1. 同一会话连续 20 轮 `gather()`，去重后的 seed 数 **> 3**（当前实现恒为 3，是回归基线）。
2. 冷却生效：某 seed 第 N 轮被选中后，`cooldownTurns` 轮内不再出现。
3. 冷却不归零导致空转：池子 4 条、`driftLimit` 3、连续 30 轮 → 每轮都有输出，无空轮。
4. 池子小于 `driftLimit`（2 条边、limit 3）→ 返回 2 条，不抛错、不补空。
5. **新边可达性**：构造「池首是老边、池尾是新边」的假数据，连续 20 轮后新边至少被选中 1 次（当前实现恒为 0）。
6. `FAKEREN_LEAK_ROTATE=0` → 退化为确定性 slice，行为与旧版一致。

**闸门一（近因回响）**
7. 新写入节点在下一个 idle 刷新后进入近因回响候选。
8. pre-step 路径**零图查询**：fake store 断言 `recent()` 调用次数为 0（缓存命中）。
9. idle 刷新时 `recent()` 恰好调用 1 次。
10. 超过 `RECENT_MAX_AGE_MS` 的节点不进候选。
11. `RECENT_LIMIT=0` → 该源关闭，其余 4 源不受影响。

**往昔回放**
12. pre-step 路径**零 `loadSessionEvents()` 调用**（fake persistence 计数断言）。
13. idle 刷新后，live 会话的已关闭轮次能通过缓存产出 `[往昔]` 种子。
14. 冷启动（未跑过 idle）→ 返回空，不抛错，与现状一致。

**溯源**
15. provenance 字符串不再出现 `by |valence| rank`，改为实际排序依据。

**回归**
16. `tests/dsh-seams.test.ts`、`tests/leak-*.test.ts` 全绿；`tests/remote-contract.test.ts` 仍 28 绿。

---

## 9. 风险与开放问题

| # | 问题 | 判断 |
|---|---|---|
| Q1 | 冷却按「轮」还是按「时间」？ | 建议按轮。按时间会引入 wall-clock 依赖，而本项目其它地方（drift 触发）刻意不做真定时。 |
| Q2 | 加权随机会不会丢失"最该漏的那条"？ | 有风险。缓解：权重差异要足够大（recency 指数衰减 + 冷却降权 0.15），让高权重 seed 仍占明显优势，而不是均匀随机。 |
| Q3 | `minValence` 这个死配置怎么办？ | 建议**删除**。跨域边从未写入 valence，接上节点 valence 需重新定义"边的情绪值"语义，不属本批范围。留着只会继续误导。 |
| Q4 | 近因回响会不会自己变成新的"反复漏同样的"？ | **会，必须防**。所以 §6.1 的冷却对**所有** drift 源统一生效（含近因回响），不是只管跨域池。这是本方案最容易漏掉的一环。 |
| Q5 | 长期会话里 idle 多久跑一次？若很久不 idle，近因缓存照样陈旧 | **开放**。需实测 idle 触发频率。若 idle 稀疏，可能要在 pre-step 侧加低频（如每 20 轮）惰性刷新。 |
| Q6 | 要不要顺手调 `GROWTH_PROB`（0.15）或放宽 PageRank top-3？ | **建议不动**。16% 覆盖率本身不是主要瓶颈（闸门二才是），且改 sidecar 图语义影响面大。先用近因回响源绕过，观察两周再定。 |

---

## 10. 不做的事

- **不动** `GROWTH_PROB` / PageRank 准入规则（见 Q6）。
- **不动**环境流（ambient）：默认关闭是 opt-in 设计，非缺陷。
- **不动** L0.5 知识轨迹的 `freshDays=1` 与每日 2 条上限：这是用户 2026-08-29 明确要的行为。本批只补齐往昔回放与近因回响，不碰既有设定。
- **不动** C2 分离约束：drift 仍不碰 `sessionQuery`，往昔回放仍只读 sessionPersistence（经缓存）。
