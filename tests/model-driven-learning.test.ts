import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { KnowledgeCandidate, KnowledgeSource, LearningDirective } from "../src/knowledge/types.js";
import type { LearnStatus } from "../src/knowledge/types.js";
import { KnowledgeSourceRegistry } from "../src/knowledge/registry.js";
import { DailyKnowledgeTracker } from "../src/knowledge/daily-tracker.js";
import { L05Trajectory } from "../src/knowledge/l05-trajectory.js";
import { LearningPlanner } from "../src/knowledge/planner.js";

/** Deterministic clock. */
function makeClock(start = new Date("2026-08-25T09:00:00")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advanceDays: (d: number) => {
      t += d * 24 * 3600 * 1000;
    },
  };
}

function cand(id: string, title: string, summary = "这是一段足够长的真实内容用于通过质量闸的摘要。", url = `https://example.com/${id}`): KnowledgeCandidate {
  return { id, title, summary, source: "Test", sourceUrl: url, rank: 1 };
}

/** Fake source: records the directive it was called with; can throw on demand. */
class FakeSource implements KnowledgeSource {
  readonly defaultMode = "top" as const;
  lastDirective: LearningDirective | undefined;
  called = 0;
  constructor(private items: KnowledgeCandidate[], private doThrow = false) {}
  async rankedCandidates(d?: LearningDirective): Promise<KnowledgeCandidate[]> {
    this.called++;
    this.lastDirective = d;
    if (this.doThrow) throw new Error("boom");
    return this.items.map((x) => ({ ...x }));
  }
}

let tmpdir: string;
beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-dual-"));
});
afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

interface Built {
  tr: DailyKnowledgeTracker;
  randomSrc: FakeSource;
  purposefulSrc: FakeSource;
  clock: ReturnType<typeof makeClock>;
}

function buildTracker(opts: {
  randomItems?: KnowledgeCandidate[];
  purposefulItems?: KnowledgeCandidate[];
  purposefulThrows?: boolean;
  plan?: LearningDirective | null;
}): Built {
  const clock = makeClock();
  const randomSrc = new FakeSource(opts.randomItems ?? [cand("r1", "随机条目")]);
  const purposefulSrc = new FakeSource(opts.purposefulItems ?? [cand("p1", "目的条目")], opts.purposefulThrows);
  const sources = new KnowledgeSourceRegistry(
    { wiki: purposefulSrc, news: purposefulSrc, social: purposefulSrc, web: purposefulSrc, static: purposefulSrc },
    "wiki",
  );
  const planner = opts.plan !== undefined ? ({ plan: async () => opts.plan } as any) : undefined;
  const tr = new DailyKnowledgeTracker(randomSrc, sources, tmpdir, planner, clock.now);
  return { tr, randomSrc, purposefulSrc, clock };
}

describe("DailyKnowledgeTracker dual-track (req_l05 dual-track)", () => {
  it("returns BOTH slots, each with correct kind/status", async () => {
    const { tr } = buildTracker({ plan: { source: "wiki", query: "猫", rationale: "因为聊过猫" } });
    const res = await tr.ensureToday("instA");
    expect(res.random?.kind).toBe("random");
    expect(res.random?.status).toBe("learned");
    expect(res.purposeful?.kind).toBe("purposeful");
    expect(res.purposeful?.status).toBe("learned");
  });

  it("random slot is mechanical: no directive reaches the random source; purposeful gets the query", async () => {
    const { tr, randomSrc, purposefulSrc } = buildTracker({
      plan: { source: "wiki", query: "猫", rationale: "r" },
    });
    await tr.ensureToday("instA");
    expect(randomSrc.lastDirective).toBeUndefined(); // random never reads the graph/model
    expect(purposefulSrc.lastDirective?.query).toBe("猫");
  });

  it("purposeful reflects the directive (source/query/rationale) and selectionPath", async () => {
    const { tr } = buildTracker({ plan: { source: "wiki", query: "猫", rationale: "因为聊过猫" } });
    const res = await tr.ensureToday("instA");
    expect(res.purposeful?.directive).toEqual({ source: "wiki", query: "猫", rationale: "因为聊过猫" });
    expect(res.purposeful?.selectionPath).toContain("因为聊过猫");
    expect(res.purposeful?.selectionPath).toContain("source=wiki");
  });

  it("planner returns null → purposeful status 'empty', no purposeful IO", async () => {
    const { tr, purposefulSrc } = buildTracker({ purposefulItems: [cand("p1", "目的条目")], plan: null });
    const res = await tr.ensureToday("instA");
    expect(res.purposeful?.status).toBe("empty");
    expect(res.purposeful?.statusNote).toContain("图库");
    expect(purposefulSrc.called).toBe(0); // 没调源
  });

  it("purposeful source returns 0 items → status 'empty' (no fallback)", async () => {
    const { tr } = buildTracker({ purposefulItems: [], plan: { source: "wiki", query: "q", rationale: "r" } });
    const res = await tr.ensureToday("instA");
    expect(res.purposeful?.status).toBe("empty");
    expect(res.purposeful?.statusNote).toBe("检索返回 0 条");
  });

  it("purposeful source returns only ad/junk → status 'junk'", async () => {
    const junk = [cand("j1", "广告", "点此领取大奖点此领取大奖点此领取大奖", "https://doubleclick.net/x")];
    const { tr } = buildTracker({ purposefulItems: junk, plan: { source: "wiki", query: "q", rationale: "r" } });
    const res = await tr.ensureToday("instA");
    expect(res.purposeful?.status).toBe("junk");
    expect(res.purposeful?.statusNote).toContain("广告/垃圾");
  });

  it("purposeful source throws → status 'error'", async () => {
    const { tr } = buildTracker({ purposefulThrows: true, plan: { source: "wiki", query: "q", rationale: "r" } });
    const res = await tr.ensureToday("instA");
    expect(res.purposeful?.status).toBe("error");
    expect(res.purposeful?.statusNote).toContain("源异常");
  });

  it("only 'learned' records surface as drift seeds (status records stay out)", async () => {
    const purposefulSrc = new FakeSource([]);
    const randomSrc = new FakeSource([cand("r1", "随机条目")]);
    const sources = new KnowledgeSourceRegistry(
      { wiki: purposefulSrc, news: purposefulSrc, social: purposefulSrc, web: purposefulSrc, static: purposefulSrc },
      "wiki",
    );
    const planner = { plan: async () => ({ source: "wiki", query: "q", rationale: "r" }) } as any;
    const tr = new DailyKnowledgeTracker(randomSrc, sources, tmpdir, planner);
    const l05 = new L05Trajectory(tr);
    await l05.tick("instA");
    const seeds = l05.seedCandidates("instA", 4);
    expect(seeds).toHaveLength(1); // only the random learned one
    expect(seeds[0].meta?.kind).toBe("random");
  });

  it("daily gates: second call same day learns nothing new; next day re-runs", async () => {
    const { tr, clock } = buildTracker({ plan: { source: "wiki", query: "q", rationale: "r" } });
    const r1 = await tr.ensureToday("instA");
    expect(r1.random && r1.purposeful).toBeTruthy();
    const r2 = await tr.ensureToday("instA");
    expect(r2.random).toBeUndefined();
    expect(r2.purposeful).toBeUndefined();
    clock.advanceDays(1);
    const r3 = await tr.ensureToday("instA");
    expect(r3.random && r3.purposeful).toBeTruthy();
  });

  it("no planner (undefined) does NOT consume the daily purposeful slot; ready planner retries same day", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-nop-"));
    try {
      const clock = makeClock();
      const randomSrc = new FakeSource([cand("r1", "随机条目")]);
      const purposefulSrc = new FakeSource([cand("p1", "目的条目")]);
      const sources = new KnowledgeSourceRegistry(
        { wiki: purposefulSrc, news: purposefulSrc, social: purposefulSrc, web: purposefulSrc, static: purposefulSrc },
        "wiki",
      );
      // 1) 无 planner：两次 idle 都不应占槽 / 不写记录
      const trNoPlanner = new DailyKnowledgeTracker(randomSrc, sources, dir, undefined, clock.now);
      expect((await trNoPlanner.ensureToday("instA")).purposeful).toBeUndefined();
      expect((await trNoPlanner.ensureToday("instA")).purposeful).toBeUndefined();
      // 2) 同目录、注入 planner：同 idle 应能真正跑（闸门未被空消耗）
      const planner = { plan: async () => ({ source: "wiki", query: "q", rationale: "r" }) } as any;
      const trReady = new DailyKnowledgeTracker(randomSrc, sources, dir, planner, clock.now);
      const res = await trReady.ensureToday("instA");
      expect(res.purposeful?.status).toBe("learned");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy ledger: a prior 'no-planner' empty no longer blocks a ready planner same day", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-legacy-"));
    try {
      const clock = makeClock();
      const randomSrc = new FakeSource([cand("r1", "随机条目")]);
      const purposefulSrc = new FakeSource([cand("p1", "目的条目")]);
      const sources = new KnowledgeSourceRegistry(
        { wiki: purposefulSrc, news: purposefulSrc, social: purposefulSrc, web: purposefulSrc, static: purposefulSrc },
        "wiki",
      );
      const today = "2026-08-25";
      // 模拟旧版本留下的「无模型规划」空记录（purposefulDoneDate 已设为当天）
      const legacy: any = {
        instanceId: "instA",
        learnedIds: [],
        lastLearnedDate: today,
        trajectory: [
          {
            id: "status-purposeful-" + today + "-empty-xxxx",
            title: "(无内容)",
            summary: "无模型规划，目的轨跳过",
            source: "model-planned",
            sourceUrl: "",
            learnedAt: clock.now().getTime(),
            chosenRank: 0,
            selectionPath: "目的轨: empty",
            kind: "purposeful",
            status: "empty",
            statusNote: "无模型规划，目的轨跳过",
          },
        ],
        randomDoneDate: today,
        purposefulDoneDate: today,
      };
      fs.writeFileSync(path.join(dir, "instA.json"), JSON.stringify(legacy));
      // 注入 planner 后，应能识别该空记录为「未真正完成」并重试
      const planner = { plan: async () => ({ source: "wiki", query: "q", rationale: "r" }) } as any;
      const trReady = new DailyKnowledgeTracker(randomSrc, sources, dir, planner, clock.now);
      const res = await trReady.ensureToday("instA");
      expect(res.purposeful?.status).toBe("learned");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("LearningPlanner (model-driven, env pinSource = lock channel not model)", () => {
  it("reads graph topics and returns a directive from the model", async () => {
    const llm = { complete: async () => '{"source":"wiki","query":"猫","rationale":"喜欢猫"}' } as any;
    const store = {
      query: async () => [{ label: "猫", instanceId: "i", type: "Entity", props: {}, valence: 0, valenceSelf: true, weight: 1, decayed: false }],
      stats: async () => ({ instanceId: "i", nodes: 3, edges: 0, decayed: 0 }),
    } as any;
    const planner = new LearningPlanner(llm, store, { recentLearnedTitles: () => [] });
    const d = await planner.plan("instA");
    expect(d?.source).toBe("wiki");
    expect(d?.query).toBe("猫");
    expect(d?.rationale).toBe("喜欢猫");
  });

  it("empty graph → returns null (records empty, no fallback)", async () => {
    const llm = { complete: async () => "{}" } as any;
    const store = { query: async () => [], stats: async () => ({ instanceId: "i", nodes: 0, edges: 0, decayed: 0 }) } as any;
    const planner = new LearningPlanner(llm, store, { recentLearnedTitles: () => [] });
    expect(await planner.plan("instA")).toBeNull();
  });

  it("pinSource overrides the chosen source but keeps model's query/rationale (dec_l05 B)", async () => {
    const llm = { complete: async () => '{"source":"wiki","query":"猫","rationale":"喜欢猫"}' } as any;
    const store = {
      query: async () => [{ label: "猫", instanceId: "i", type: "Entity", props: {}, valence: 0, valenceSelf: true, weight: 1, decayed: false }],
      stats: async () => ({ instanceId: "i", nodes: 3, edges: 0, decayed: 0 }),
    } as any;
    const planner = new LearningPlanner(llm, store, { recentLearnedTitles: () => [], pinSource: "news" });
    const d = await planner.plan("instA");
    expect(d?.source).toBe("news"); // 锁渠道
    expect(d?.query).toBe("猫"); // 模型仍定
    expect(d?.rationale).toBe("喜欢猫");
  });
});
