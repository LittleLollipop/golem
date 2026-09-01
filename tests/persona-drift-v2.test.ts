/**
 * 三层人格坐标系（docs/persona-drift-dimensions.md §10）的单元测试。
 *
 * 与 tests/persona-drift.test.ts 的分工：那个文件守「机制」（幂等 / 跳过 /
 * 边），本文件守「坐标系」——重力回弹、维度映射、per-dim cap、schema 版本
 * 过滤、trait 推断、evidence 引用。
 *
 * 覆盖文档 §10 用例 1-13：
 *   1  delta 恒 +0.15 / target 0 → 收敛到 ≈ +0.5，100 天不越界
 *   2  软带内回弹系数 = REVERT_K
 *   3  |cum-target| = 0.7 → 单日净增量为负
 *   4  target 平移 → 稳态中心随之平移
 *   5  回弹量写入节点 props.revertPull（可审计）
 *   6  FAKEREN_DRIFT_DIMS 覆盖生效，未列出的维度被丢弃
 *   7  per-dim cap：emotionality 0.15 → 记 0.08
 *   8  targetOf 映射：verbosity → trait.X，playfulness → (X+O)/2
 *   9  traitBaseline 缺失 → target 全 0，功能不中断
 *   10 v1 节点（无 schemaVersion）不进入 v2 累积计算
 *   11 v1 链仍在图中可读（未被删除）
 *   12 inferTraitBaseline 幂等（同输入两次结果一致，允许 ±0.1 抖动）
 *   13 LLM 返回非法 JSON → 回退全 0 基线，不抛
 * 附加：evidence 悬空边修复（§6.4）——Q5 裁定同批修
 */
import { describe, it, expect } from "vitest";
import type { GraphNode, InstanceId, TraitBaseline } from "../src/types.js";
import type { LlmClient } from "../src/llm/client.js";
import {
  PersonaDriftService,
  revertPull,
  targetOf,
  inferTraitBaseline,
  activeDimDefs,
  DIM_DEFS,
  DRIFT_SCHEMA_VERSION,
} from "../src/agent/persona-drift.js";
import type { PersonaDriftConfig } from "../src/leak/config.js";
import { FakeGraphStore } from "./fake-graph-store.js";

const INST = "test-inst";
const NOW = new Date(2026, 7, 30); // 2026-08-30

const V2_DIMS = [
  "extraversion",
  "agreeableness",
  "openness",
  "emotionality",
  "verbosity",
  "playfulness",
];

function cfg(over: Partial<PersonaDriftConfig> = {}): PersonaDriftConfig {
  return {
    enabled: true,
    dailyDeltaCap: 0.15,
    cumulativeClamp: 1.0,
    recentDays: 7,
    historyDays: 14,
    dims: [...V2_DIMS],
    revertK: 0.2,
    softBand: 0.4,
    dimCaps: { emotionality: 0.08 },
    heuristicVol: false,
    reportDir: "/tmp/golem-drift-test",
    ...over,
  };
}

class FakeLlm implements LlmClient {
  /** 记录每次收到的 system/user，便于断言提示词内容。 */
  readonly calls: Array<{ system: string; user: string }> = [];
  constructor(private resp: string) {}
  async complete(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    return this.resp;
  }
}

function mkEvent(id: string, props: Record<string, unknown>, ts: number, instanceId: InstanceId = INST): GraphNode {
  return {
    id,
    type: "Event",
    label: typeof props.userText === "string" ? String(props.userText).slice(0, 40) : id,
    instanceId,
    props,
    valence: 0,
    valenceSelf: true,
    weight: 1,
    decayed: false,
    timestamp: ts,
  };
}

function seedDialogue(store: FakeGraphStore, daysAgo: number, id = `evt_${daysAgo}`): void {
  store.addNode(
    mkEvent(
      id,
      {
        userText: "你觉得写作技巧有哪些",
        assistantSummary: "我建议先从结构入手，写大纲再填充细节。",
      },
      NOW.getTime() - daysAgo * 86_400_000,
    ),
  );
}

function driftNode(id: string, date: string, cumulative: Record<string, number>, extra: Record<string, unknown> = {}): GraphNode {
  return mkEvent(id, { kind: "persona_drift", date, dims: {}, cumulative, evidence: [], ...extra }, NOW.getTime() - 86_400_000);
}

// ── §5.2 重力回弹 ──────────────────────────────────────────────────────────

describe("重力回弹 revertPull", () => {
  it("用例2：软带内回弹系数 = REVERT_K（自由漂移带生效）", () => {
    const k = 0.2;
    const band = 0.4;
    // d = 0.2（软带内）→ 系数应为 0.2，回弹量 = -0.2 * 0.2 = -0.04
    expect(revertPull(0.2, 0, k, band)).toBeCloseTo(-0.04, 6);
    // d = 0.4（软带边界）→ 系数仍为 0.2
    expect(revertPull(0.4, 0, k, band)).toBeCloseTo(-0.08, 6);
  });

  it("用例3：|cum-target| = 0.7 → 单日净增量为负（强制回落）", () => {
    // d = 0.7，over = 0.3 → 系数 = 0.2 * (1 + 0.3/0.2) = 0.5 → 回弹 -0.35
    const pull = revertPull(0.7, 0, 0.2, 0.4);
    expect(pull).toBeCloseTo(-0.35, 6);
    // 即使模型当天给满 +0.15，净增量仍为负
    expect(0.15 + pull).toBeLessThan(0);
  });

  it("回弹方向恒定为指向 target（过冲不会发生）", () => {
    expect(revertPull(-0.9, 0, 0.2, 0.4)).toBeGreaterThan(0);
    expect(revertPull(0.9, 0, 0.2, 0.4)).toBeLessThan(0);
    expect(revertPull(0.1, 0.6, 0.2, 0.4)).toBeGreaterThan(0); // 低于 target → 往上拉
  });
});

describe("用例1：delta 恒 +0.15 / target 0 → 收敛到 ≈ +0.5，100 天不越界", () => {
  it("累积稳定在稳态偏移内，且永不贴边", async () => {
    // 纯数学模拟（不经 LLM）：复现 introspect 里的累积公式
    let cum = 0;
    const k = 0.2;
    const band = 0.4;
    const series: number[] = [];
    for (let day = 0; day < 100; day++) {
      cum = Math.max(-1, Math.min(1, cum + 0.15 + revertPull(cum, 0, k, band)));
      series.push(cum);
    }
    const steady = series[series.length - 1];
    // 稳态：0.15 = coeff * d → 0.15 = 0.2*(1+(d-0.4)/0.2)*d
    // 解得 d ≈ 0.5（文档 §5.2 表格）
    expect(steady).toBeGreaterThan(0.45);
    expect(steady).toBeLessThan(0.55);
    // 全程不越界、不贴边
    expect(Math.max(...series)).toBeLessThan(0.9);
  });
});

describe("用例4：target 平移 → 稳态中心随之平移", () => {
  it("target=0.6 时累积稳定在 ≈ +1.0 附近", async () => {
    let cum = 0;
    for (let day = 0; day < 200; day++) {
      cum = Math.max(-1, Math.min(1, cum + 0.15 + revertPull(cum, 0.6, 0.2, 0.4)));
    }
    // target 0.6 → 稳态 ≈ 1.0（被 clamp 兜住）
    expect(cum).toBeGreaterThan(0.9);
    expect(cum).toBeLessThanOrEqual(1.0);
  });
});

describe("用例5：回弹量写入节点 props（可审计）", () => {
  it("revertPull / traitTarget 落盘，可从图里读回", async () => {
    const store = new FakeGraphStore();
    store.setMeta(INST, {
      id: INST, name: "t", createdAt: 0, turns: 0,
      traitBaseline: { H: 0, E: 0, X: 0.5, A: 0, C: 0, O: 0 },
    });
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { extraversion: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());
    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();
    // target 来自 trait.X = 0.5
    expect(rec!.traitTarget!.extraversion).toBe(0.5);
    // 当前 cum 0 < target 0.5 → 回弹为正（往上拉）
    expect(rec!.revertPull!.extraversion).toBeGreaterThan(0);

    const node = store.allNodes.find((n) => (n.props as any).kind === "persona_drift")!;
    expect((node.props as any).schemaVersion).toBe(DRIFT_SCHEMA_VERSION);
    expect((node.props as any).revertPull).toBeDefined();
    expect((node.props as any).traitTarget).toBeDefined();
  });
});

// ── §5.3 targetOf 映射 ────────────────────────────────────────────────────

describe("用例8：targetOf 映射", () => {
  const trait: TraitBaseline = { H: 0.9, E: -0.3, X: 0.4, A: -0.2, C: 0.7, O: 0.6 };
  it("state 四维直接映射 HEXACO 同名轴", () => {
    expect(targetOf("extraversion", trait)).toBe(0.4);
    expect(targetOf("agreeableness", trait)).toBe(-0.2);
    expect(targetOf("openness", trait)).toBe(0.6);
    expect(targetOf("emotionality", trait)).toBe(-0.3);
  });
  it("表现层用代理映射：verbosity → X，playfulness → (X+O)/2", () => {
    expect(targetOf("verbosity", trait)).toBe(0.4);
    expect(targetOf("playfulness", trait)).toBeCloseTo(0.5, 6);
  });
  it("未知维度退化为 0，不抛", () => {
    expect(targetOf("不存在的维度", trait)).toBe(0);
  });
});

describe("用例9：traitBaseline 缺失 → target 全 0，功能不中断", () => {
  it("未标注 / 无 meta 都能正常跑完内省", async () => {
    const store = new FakeGraphStore(); // 无 meta
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());
    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();
    expect(rec!.traitTarget!.openness).toBe(0);
    expect(rec!.cumulative.openness).toBeGreaterThan(0); // 仍产生了漂移
  });
});

// ── §4.3 / §8.1 per-dim cap ───────────────────────────────────────────────

describe("用例7：per-dim cap", () => {
  it("emotionality 请求 0.15 → 实际记 0.08；其它维仍 0.15", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    const llm = new FakeLlm(
      JSON.stringify({ dims: { emotionality: 0.15, openness: 0.15 }, evidence: [] }),
    );
    const svc = new PersonaDriftService(store, llm, cfg());
    const rec = await svc.introspect(INST, NOW);
    expect(rec!.dims.emotionality).toBeCloseTo(0.08, 6);
    expect(rec!.dims.openness).toBeCloseTo(0.15, 6);
  });
});

describe("用例6：FAKEREN_DRIFT_DIMS 覆盖生效", () => {
  it("未列出的维度被丢弃", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    const llm = new FakeLlm(
      JSON.stringify({ dims: { extraversion: 0.1, openness: 0.1, playfulness: 0.1 }, evidence: [] }),
    );
    const svc = new PersonaDriftService(store, llm, cfg({ dims: ["extraversion", "openness"] }));
    const rec = await svc.introspect(INST, NOW);
    expect(Object.keys(rec!.dims).sort()).toEqual(["extraversion", "openness"]);
    expect(rec!.dims.playfulness).toBeUndefined();
  });

  it("activeDimDefs 对未知维度给兜底定义（UI 不崩）", () => {
    const defs = activeDimDefs(["extraversion", "自定义维度"]);
    expect(defs).toHaveLength(2);
    expect(defs[0].label).toBe("外向性");
    expect(defs[1].label).toBe("自定义维度");
    expect(DIM_DEFS.map((d) => d.key)).toEqual([
      "extraversion", "agreeableness", "openness", "emotionality", "verbosity", "playfulness",
    ]);
  });
});

// ── §7 迁移 ───────────────────────────────────────────────────────────────

describe("用例10/11：v1 链归档", () => {
  it("v1 节点（无 schemaVersion）不参与 v2 累积计算", async () => {
    const store = new FakeGraphStore();
    // 一条 v1 记录：旧五维，累积 openness 0.95（旧语义）
    store.addNode(
      mkEvent("drift-v1", {
        kind: "persona_drift",
        date: "2026-08-20",
        dims: { openness: 0.95 },
        cumulative: { openness: 0.95, warmth: 0.5 },
        evidence: [],
      }, NOW.getTime() - 10 * 86_400_000),
    );
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());

    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();
    // v1 的 0.95 没有被继承 → 新累积从 0 起步（+0.1 + 回弹）
    expect(rec!.cumulative.openness).toBeLessThan(0.15);
    // 旧的 warmth 维度彻底不出现
    expect(rec!.cumulative.warmth).toBeUndefined();
  });

  it("v1 节点仍留在图里（未被删除，可供审计）", async () => {
    const store = new FakeGraphStore();
    store.addNode(
      mkEvent("drift-v1", {
        kind: "persona_drift", date: "2026-08-20",
        dims: { openness: 0.95 }, cumulative: { openness: 0.95 }, evidence: [],
      }, NOW.getTime() - 10 * 86_400_000),
    );
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());
    await svc.introspect(INST, NOW);

    const v1 = store.allNodes.find((n) => n.id === "drift-v1");
    expect(v1).toBeDefined();
    expect((v1!.props as any).cumulative.openness).toBe(0.95);
  });

  it("composeEffectivePersona 忽略 v1 链（不会用旧维度渲染人设）", async () => {
    const store = new FakeGraphStore();
    store.addNode(driftNode("drift-v1", "2026-08-20", { warmth: 0.8 })); // v1：无 schemaVersion
    const svc = new PersonaDriftService(store, undefined, cfg());
    const out = await svc.composeEffectivePersona("你是林夏。", INST);
    expect(out).toBe("你是林夏。"); // 无倾可加
  });
});

// ── §6.4 evidence 引用修复（Q5） ───────────────────────────────────────────

describe("evidence 引用：不再建悬空边", () => {
  it("真实 nodeId → 建边；悬空 → 只计 skipped，不建边", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1, "evt_1"); // 真实存在的节点
    const llm = new FakeLlm(
      JSON.stringify({
        dims: { openness: 0.1 },
        evidence: [
          { nodeId: "evt_1", quote: "用户问写作技巧" },
          { nodeId: "evt_不存在", quote: "模型编造的 id" },
          { quote: "只有引文没有 id" },
        ],
      }),
    );
    const svc = new PersonaDriftService(store, llm, cfg());
    const rec = await svc.introspect(INST, NOW);
    expect(rec).not.toBeNull();

    // 建成的边只指向真实节点
    const edges = store.allEdges.filter((e) => e.kind === "relates");
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBe("evt_1");
    // 悬空的两条被记为 skipped
    expect(rec!.evidenceRefs).toHaveLength(3);
  });

  it("裸字符串恰好是真实节点 id 时仍可建边（旧 JSON 兼容）", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1, "evt_1");
    const llm = new FakeLlm(
      JSON.stringify({ dims: { openness: 0.1 }, evidence: ["evt_1"] }),
    );
    const svc = new PersonaDriftService(store, llm, cfg());
    await svc.introspect(INST, NOW);
    expect(store.allEdges.filter((e) => e.kind === "relates" && e.to === "evt_1")).toHaveLength(1);
  });

  it("文本型 evidence（旧 bug 的输入）不再产生任何边", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1);
    // 这正是实测里模型返回的形态：一整句用户原话
    const llm = new FakeLlm(
      JSON.stringify({
        dims: { openness: 0.1 },
        evidence: ["U: 你知道写故事的节拍吗? 你觉得这几卷分别应该用什么节拍模式写呀"],
      }),
    );
    const svc = new PersonaDriftService(store, llm, cfg());
    await svc.introspect(INST, NOW);
    expect(store.allEdges.filter((e) => e.kind === "relates")).toHaveLength(0);
  });

  it("提示词把候选 id 喂给了模型（治根因）", async () => {
    const store = new FakeGraphStore();
    seedDialogue(store, 1, "evt_42");
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());
    await svc.introspect(INST, NOW);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].user).toContain("[evt_42]");
    // 并且要求模型从候选 id 中选、不许编造
    expect(llm.calls[0].system).toContain("绝不自己编造 id");
  });

  it("提示词给出当前偏离量 + mood 与 emotionality 的切割（治恒定 delta）", async () => {
    const store = new FakeGraphStore();
    store.addNode(driftNode("d1", "2026-08-29", { openness: 0.6 }, { schemaVersion: 2 }));
    seedDialogue(store, 1);
    const llm = new FakeLlm(JSON.stringify({ dims: { openness: 0.1 }, evidence: [] }));
    const svc = new PersonaDriftService(store, llm, cfg());
    await svc.introspect(INST, NOW);
    // 偏离量 0.6 必须出现在给模型的上下文里
    expect(llm.calls[0].user).toContain("0.6");
    expect(llm.calls[0].system).toContain("性格不会每天都变");
    expect(llm.calls[0].system).toContain("mood");
    expect(llm.calls[0].system).toContain("emotionality");
  });
});

// ── §6.1 trait 推断 ───────────────────────────────────────────────────────

describe("用例12/13：inferTraitBaseline", () => {
  const core = "你是林夏，内向、慢热，但对熟人会滔滔不绝。从不说谎，也不占人便宜。";

  it("同一段人设连续两次 → 结果一致（幂等）", async () => {
    const llm = new FakeLlm(JSON.stringify({ H: 0.8, E: 0.2, X: -0.4, A: 0.3, C: 0.1, O: 0.5 }));
    const a = await inferTraitBaseline(core, llm);
    const b = await inferTraitBaseline(core, llm);
    for (const k of ["H", "E", "X", "A", "C", "O"] as const) {
      expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(0.1);
    }
  });

  it("非法 JSON → 回退全 0，不抛异常", async () => {
    const t = await inferTraitBaseline(core, new FakeLlm("这不是 JSON"));
    expect(t).toEqual({ H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 });
  });

  it("越界值被 clamp 到 [-1,1]", async () => {
    const t = await inferTraitBaseline(core, new FakeLlm(JSON.stringify({ H: 5, E: -9, X: 0.3 })));
    expect(t.H).toBe(1);
    expect(t.E).toBe(-1);
    expect(t.X).toBe(0.3);
  });

  it("无 LLM → 回退全 0（降级不崩）", async () => {
    const t = await inferTraitBaseline(core, undefined);
    expect(t).toEqual({ H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 });
  });
});
