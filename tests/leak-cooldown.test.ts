/**
 * Drift seed-pool regression suite (docs/leak-seed-pool.md §5).
 *
 * The bug this file exists to keep dead: the 2026-08-29 requirement "同一个会话
 * 里相同的记忆不需要反复的漏" was implemented as **no dedup at all** on the
 * cross-domain channel (old knowledge leaked 20 of 40 turns) and as **infinite**
 * dedup on L0.5 (three new facts each leaked once, then went silent for 67 / 17
 * / 3 turns). One requirement, two opposite implementations. Both channels now
 * cool down through one shared LeakCooldown.
 *
 * Every test below is deterministic: the RNG is injected, no wall-clock reads
 * inside assertions, no network.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DriftChannel } from "../src/channels/drift-channel.js";
import { L05Trajectory } from "../src/knowledge/l05-trajectory.js";
import { DailyKnowledgeTracker } from "../src/knowledge/daily-tracker.js";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";
import { KnowledgeSourceRegistry } from "../src/knowledge/registry.js";
import { LeakCooldown } from "../src/leak/cooldown.js";
import { BackgroundTaskLog } from "../src/scheduler/background-log.js";
import type { LeakConfig } from "../src/leak/config.js";
import type { GraphEdge } from "../src/types.js";
import type { LearnedFact } from "../src/knowledge/types.js";
import type { DailyKnowledgeTracker as Tracker } from "../src/knowledge/daily-tracker.js";

const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00:00Z

const cfg = (over: Partial<LeakConfig> = {}): LeakConfig => ({
  maxSeeds: 0,
  driftLimit: 3,
  ambientLimit: 0,
  l05Limit: 2,
  l05FreshDays: 1,
  triggerProbability: 1,
  ...over,
});

const noPersist = { loadSessionEvents: async () => [] } as any;
const noRegistry = { sessionsOf: async () => [] } as any;

function edge(from: string, to: string, weight = 1): GraphEdge {
  return { from, to, kind: "crossdomain_weak", instanceId: "i", weight } as GraphEdge;
}

/** Deterministic RNG: cycles through a fixed script (repeatable "randomness"). */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function fact(over: Partial<LearnedFact> = {}): LearnedFact {
  return {
    id: "f1",
    title: "凯耶达尔",
    summary: "一种测氮方法",
    source: "Wikipedia",
    sourceUrl: "https://zh.wikipedia.org/wiki/凯耶达尔法",
    learnedAt: T0,
    chosenRank: 1,
    selectionPath: "随机选 (rank 1, 来源 Wikipedia)",
    kind: "random",
    status: "learned",
    ...over,
  };
}

/** Minimal tracker double: L05Trajectory only needs recentTrajectory + ensureToday. */
function fakeTracker(facts: LearnedFact[]): Tracker {
  return {
    recentTrajectory: (_id: string, limit = 7) => facts.slice(0, limit),
    ensureToday: async () => null,
  } as unknown as Tracker;
}

// ── 1. 去重对称性：直接回归用户报告的两个现象 ──────────────────────────────

describe("去重对称性 (docs/leak-seed-pool.md §5 用例 1-4)", () => {
  it("用例1 旧的不再每轮刷屏：同一会话 40 轮内，任一跨域边在连续 10 轮内不重复", async () => {
    // 实测里普雷斯顿 / 科索沃各漏了 20/40 轮 —— 就是这条在修。
    // 池子按真实量级造（实测跨域池 69 条边）：池子太小会让冷却把所有边都挡住，
    // 那样测的就不是去重而是空转。
    const pool = [
      edge("普雷斯顿2014-15赛季", "上次讨论节拍结构", 0.9),
      edge("科索沃市镇", "上次讨论节拍结构", 0.8),
      edge("科索沃", "科索沃（地名）", 0.7),
      ...Array.from({ length: 27 }, (_, i) => edge(`边${i}A`, `边${i}B`, 0.5)),
    ];
    const reader = { crossDomain: async () => pool } as any;
    const ch = new DriftChannel(
      reader, noPersist, noRegistry, undefined, undefined,
      cfg({ driftLimit: 3 }), undefined, new LeakCooldown(), scripted([0.1, 0.5, 0.9, 0.3, 0.7]),
    );

    const lastSeen = new Map<string, number>();
    let emptyTurns = 0;
    for (let turn = 0; turn < 40; turn++) {
      const out = await ch.gather("instA", undefined, "sess-long", T0 + turn * 60_000);
      const xd = out.filter((x) => x.content.startsWith("[跨域联想]"));
      if (xd.length === 0) emptyTurns++;
      for (const c of xd) {
        const prev = lastSeen.get(c.seedId);
        if (prev !== undefined) {
          expect(turn - prev, `${c.seedId} 在 ${turn} 轮重复（上次 ${prev} 轮）`).toBeGreaterThanOrEqual(10);
        }
        lastSeen.set(c.seedId, turn);
      }
    }
    // 池子被真正轮转过，不是只有前 3 条拿到永久席位
    expect(lastSeen.size).toBeGreaterThanOrEqual(12);
    // 冷却没有把整个通道饿死（30 条边 / 10 轮冷却 → 每轮 3 条供给充足）
    expect(emptyTurns).toBe(0);
  });

  it("用例2 新的不再消失：知识在冷却期后可再次漏出（现状：1 次后 67 轮不再现）", () => {
    const l05 = new L05Trajectory(fakeTracker([fact({ id: "k1" })]), 7, undefined, 30);
    // 00:08 学到 → 00:45 漏出
    expect(l05.seedCandidates("instA", 2, "sessA", T0)).toHaveLength(1);
    // 同一会话紧接着的下一轮 → 冷却中（这条要求仍然成立）
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 60_000)).toHaveLength(0);
    // 7 小时后 → 冷却结束，同一个会话里可以再漏（旧行为：永远 0）
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 7 * 3600_000)).toHaveLength(1);
  });

  it("用例2b 冷却必须显著小于 freshDays：否则只漏一次的旧行为原样保留", () => {
    // 这条锁住 2026-09-03 实现时发现的漏洞：freshDays=1 时若把冷却也设成 24h，
    // 窗口内同样只能漏 1 次 —— 与旧的永久排除等价，bug 原封不动。
    const l05 = new L05Trajectory(fakeTracker([fact({ id: "k1" })]), 7, undefined, 1);
    const hits: number[] = [];
    for (let h = 0; h <= 24; h++) {
      if (l05.seedCandidates("instA", 2, "sessA", T0 + h * 3600_000).length > 0) hits.push(h);
    }
    // fresh 窗口 24h 内至少浮现 3 次（0h / 6h / 12h / 18h），而不是 1 次
    expect(hits.length).toBeGreaterThanOrEqual(3);
    // 且确实被冷却过：不是每小时都漏
    expect(hits.length).toBeLessThan(24);
  });

  it("用例3 长期会话不饿死：12 小时的连续会话（40 轮）里知识种子浮现 ≥2 次", async () => {
    // 场景对齐用户的原话"一个没有关闭的长期会话"：40 轮发生在 12 小时内。
    // freshDays=30 让"陈旧"不成为变量，只考察冷却这一步。
    // ⚠️ 若把 L0.5 冷却设成 24h，这条只能漏 1 次 → 必然失败（已变异验证）。
    const l05 = new L05Trajectory(fakeTracker([fact({ id: "k1", title: "凯耶达尔" })]), 7, undefined, 30);
    const ch = new DriftChannel(
      { crossDomain: async () => [] } as any, noPersist, noRegistry, undefined, l05,
      cfg({ driftLimit: 0, l05Limit: 2 }), undefined, new LeakCooldown(), scripted([0.5]),
    );

    const hits: number[] = [];
    for (let turn = 0; turn < 40; turn++) {
      const now = T0 + turn * 18 * 60_000; // 40 轮 = 12 小时
      const out = await ch.gather("instA", undefined, "sess-long", now);
      if (out.some((c) => c.content.startsWith("[知识轨迹]"))) hits.push(turn);
    }
    // 6h 冷却 → 第 0 轮与第 20 轮各漏一次；且不是每轮都漏
    expect(hits).toEqual([0, 20]);
  });

  it("用例4 两条通道共用同一个冷却实现，防止二次漂移", async () => {
    const shared = new LeakCooldown();
    const l05 = new L05Trajectory(fakeTracker([fact()]), 7, undefined, 30);
    const ch = new DriftChannel(
      { crossDomain: async () => [edge("a", "b")] } as any, noPersist, noRegistry,
      undefined, l05, cfg(), undefined, shared, scripted([0.5]),
    );
    expect(l05.cooldownTable).toBe(shared);
    // 一次 gather 里，跨域与 L0.5 各自把记录写进同一张表
    await ch.gather("instA", undefined, "sessA", T0);
    expect(shared.hasLeaked("sessA", "xd:crossdomain_weak:a->b")).toBe(true);
    expect(shared.hasLeaked("sessA", "f1")).toBe(true);
    // 紧接着的下一轮：两条通道同时被冷却按住（同一张表，不是各记各的）
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 60_000)).toHaveLength(0);
    const out2 = await ch.gather("instA", undefined, "sessA", T0 + 60_000);
    expect(out2.filter((c) => c.content.startsWith("[跨域联想]"))).toHaveLength(0);
    // 各自的窗口到点后一起解禁（L0.5 6h / 跨域 30 分钟）
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 7 * 3600_000)).toHaveLength(1);
    const out3 = await ch.gather("instA", undefined, "sessA", T0 + 31 * 60_000);
    expect(out3.filter((c) => c.content.startsWith("[跨域联想]"))).toHaveLength(1);
  });
});

// ── 2. L0.5 (docs §5 用例 5-9) ────────────────────────────────────────────

describe("L0.5 冷却语义", () => {
  const realTracker = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-l05-cool-"));
    const tr = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      dir,
    );
    return { tr, dir };
  };

  it("用例5 freshDays 硬门槛仍生效：超过天数的知识不进候选（冷却不是绕过它的后门）", () => {
    const l05 = new L05Trajectory(fakeTracker([fact({ learnedAt: T0 })]), 7, undefined, 1);
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 12 * 3600_000)).toHaveLength(1);
    // 冷却早就过期了，但 freshness 仍然把它挡在外面
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 2 * DAY)).toHaveLength(0);
  });

  it("用例6 recency：候选按新→旧返回，刚学的排在前面", () => {
    const l05 = new L05Trajectory(
      fakeTracker([
        fact({ id: "new", title: "刚学的", learnedAt: T0 + 3 * DAY }),
        fact({ id: "old", title: "三天前学的", learnedAt: T0 }),
      ]),
      7, undefined, 30,
    );
    const seeds = l05.seedCandidates("instA", 1, "sessA", T0 + 3 * DAY);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].observationText).toBe("刚学的");
  });

  it("用例7 status=empty 的记录永不进候选", () => {
    const l05 = new L05Trajectory(
      fakeTracker([fact({ id: "e1", status: "empty" }), fact({ id: "j1", status: "junk" })]),
      7, undefined, 30,
    );
    expect(l05.seedCandidates("instA", 2, "sessA", T0)).toHaveLength(0);
  });

  it("用例8 加权随机无饿死：同一候选池跑 1000 次，每条都被选中过", async () => {
    const reader = {
      crossDomain: async () => [edge("a", "b"), edge("c", "d"), edge("e", "f"), edge("g", "h")],
    } as any;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const ch = new DriftChannel(
        reader, noPersist, noRegistry, undefined, undefined,
        cfg({ driftLimit: 2 }), undefined, new LeakCooldown(), Math.random,
      );
      const out = await ch.gather("instA", undefined, `s${i}`);
      for (const c of out) seen.add(c.seedId);
    }
    expect(seen.size).toBe(4);
  });

  it("用例9 会话级冷却隔离：新 sessionId 重置计数", () => {
    const l05 = new L05Trajectory(fakeTracker([fact({ id: "k1" })]), 7, undefined, 30);
    expect(l05.seedCandidates("instA", 2, "sessA", T0)).toHaveLength(1);
    expect(l05.seedCandidates("instA", 2, "sessA", T0 + 60_000)).toHaveLength(0);
    // 换一个会话 → 冷却表是新的，可以再漏一次
    expect(l05.seedCandidates("instA", 2, "sessB", T0 + 60_000)).toHaveLength(1);
  });

  it("真实 tracker 下的冒烟：学到的知识会作为 [知识轨迹] 种子出现在漂移里", async () => {
    const { tr, dir } = realTracker();
    const l05 = new L05Trajectory(tr, 7, undefined, 30);
    const learned = (await l05.tick("instA"))?.random;
    const ch = new DriftChannel(
      { crossDomain: async () => [] } as any, noPersist, noRegistry, undefined, l05,
      cfg({ driftLimit: 0 }), undefined, new LeakCooldown(), scripted([0.5]),
    );
    const out = await ch.gather("instA", undefined, "sessA");
    const k = out.filter((c) => c.content.startsWith("[知识轨迹]"));
    expect(k).toHaveLength(1);
    expect(k[0].content).toContain(learned!.title);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── 3. 轮转与溯源 (docs §5 用例 13-14) ───────────────────────────────────

describe("跨域轮转与溯源 (docs/leak-seed-pool.md §4.2)", () => {
  it("用例13 连续 10 轮 gather：种子不完全重复，且没漏过的边有机会入选", async () => {
    const reader = {
      crossDomain: async () => [
        edge("最老的边", "A", 1.0),
        edge("第二老的边", "B", 1.0),
        edge("第三老的边", "C", 1.0),
        edge("新入池的边", "D", 1.0),
        edge("又新入池的边", "E", 1.0),
        edge("再新入池的边", "F", 1.0),
      ],
    } as any;
    const ch = new DriftChannel(
      reader, noPersist, noRegistry, undefined, undefined,
      cfg({ driftLimit: 3 }), undefined, new LeakCooldown(), Math.random,
    );
    const perTurn: string[][] = [];
    for (let t = 0; t < 10; t++) {
      const out = await ch.gather("instA", undefined, "sessA");
      perTurn.push(out.map((c) => c.seedId));
      // 单轮内绝不重复（无放回采样）
      expect(new Set(out.map((c) => c.seedId)).size).toBe(out.length);
    }
    // 各轮之间不完全相同 —— 旧实现下 10 轮会一字不差地重复 10 次
    const distinct = new Set(perTurn.map((ids) => [...ids].sort().join("|")));
    expect(distinct.size).toBeGreaterThan(1);
    // 池尾的"新"边也漏出来过（插入序 slice(0,3) 下它们永远拿不到席位）
    expect(perTurn.flat().some((id) => id.includes("新入池的边"))).toBe(true);
  });

  it("用例14 溯源串不含 |valence| rank；minValence 配置项已移除", async () => {
    const reader = { crossDomain: async () => [edge("a", "b"), edge("c", "d")] } as any;
    const ch = new DriftChannel(
      reader, noPersist, noRegistry, undefined, undefined,
      cfg({ driftLimit: 2 }), undefined, new LeakCooldown(), scripted([0.5]),
    );
    const out = await ch.gather("instA", undefined, "sessA");
    for (const c of out) {
      expect(c.provenance?.selectionPath).toMatch(
        /^crossDomain weighted-rotate \(w=[\d.]+, idle=(new|\d+t)\)$/,
      );
      expect(c.provenance?.selectionPath).not.toContain("valence");
    }
    // 死配置已删：env 与 config 类型都不再有 minValence
    const { loadLeakConfig } = await import("../src/leak/config.js");
    expect(Object.keys(loadLeakConfig())).not.toContain("minValence");
  });
});

// ── 4. 往昔回放 (docs §5 用例 15-16) ─────────────────────────────────────

describe("往昔回放不再对 live 会话做注定失败的调用 (docs §4.4)", () => {
  it("用例15 live 会话下 loadSessionEvents 一次都不调用", async () => {
    const spy = vi.fn(async () => []);
    // 该实例只绑定了当前这一个（live）会话
    const registry = { sessionsOf: async () => ["sess-live"] } as any;
    const ch = new DriftChannel(
      { crossDomain: async () => [] } as any, { loadSessionEvents: spy } as any, registry,
      undefined, undefined, cfg(), undefined, new LeakCooldown(), scripted([0.5]),
    );
    await ch.gather("instA", undefined, "sess-live");
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("已关闭的会话仍然回放（不过度过滤）", async () => {
    const evs = [
      { type: "user", timestamp: 100, payload: { text: "随便聊聊" } },
      { type: "assistant", timestamp: 200, payload: { text: "好啊。" } },
    ];
    const spy = vi.fn(async () => evs as any);
    const registry = { sessionsOf: async () => ["sess-old", "sess-live"] } as any;
    const ch = new DriftChannel(
      { crossDomain: async () => [] } as any, { loadSessionEvents: spy } as any, registry,
      undefined, undefined, cfg(), undefined, new LeakCooldown(), scripted([0.5]),
    );
    const out = await ch.gather("instA", undefined, "sess-live");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("sess-old");
    expect(out.filter((c) => c.content.startsWith("[往昔]"))).toHaveLength(1);
  });

  it("用例16 hist=0 时日志明确记录跳过原因，而不是静默", async () => {
    const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "golem-hist-")), "s.log");
    const log = new BackgroundTaskLog(logPath);
    const registry = { sessionsOf: async () => ["sess-live"] } as any;
    const ch = new DriftChannel(
      { crossDomain: async () => [] } as any, noPersist, registry,
      undefined, undefined, cfg(), log, new LeakCooldown(), scripted([0.5]),
    );
    await ch.gather("instA", undefined, "sess-live");
    const last = log.read(1)[0];
    expect(last.kind).toBe("drift");
    expect(last.detail.bySource).toMatchObject({ hist: 0, histSkipped: 1 });
  });
});

// ── 5. LeakCooldown 单元语义 ──────────────────────────────────────────────

describe("LeakCooldown 语义", () => {
  it("多闸门取先到：10 轮或 30 分钟，任一满足即解禁", () => {
    const cd = new LeakCooldown();
    for (let i = 0; i < 10; i++) cd.beginTurn("s");
    cd.take("s", "k", T0);
    expect(cd.available("s", "k", { turns: 10, ms: 30 * 60_000 }, T0 + 60_000)).toBe(false);
    // 30 分钟先到（只过了 3 轮）
    for (let i = 0; i < 3; i++) cd.beginTurn("s");
    expect(cd.available("s", "k", { turns: 10, ms: 30 * 60_000 }, T0 + 31 * 60_000)).toBe(true);
  });

  it("未声明的闸门不等于已满足（纯时间策略不会被 turns 立即放行）", () => {
    const cd = new LeakCooldown();
    cd.take("s", "k", T0);
    for (let i = 0; i < 50; i++) cd.beginTurn("s");
    // 只声明了 ms → 轮次再多也不解禁
    expect(cd.available("s", "k", { ms: 24 * 3600_000 }, T0 + 60_000)).toBe(false);
    expect(cd.available("s", "k", { ms: 24 * 3600_000 }, T0 + 25 * 3600_000)).toBe(true);
  });

  it("turnsSince：未漏过的键视为最饥饿（cap），久未漏的权重更高", () => {
    const cd = new LeakCooldown();
    cd.beginTurn("s");
    expect(cd.turnsSince("s", "never", 10)).toBe(10);
    cd.take("s", "k", T0);
    expect(cd.turnsSince("s", "k", 10)).toBe(0);
    for (let i = 0; i < 4; i++) cd.beginTurn("s");
    expect(cd.turnsSince("s", "k", 10)).toBe(4);
  });
});
