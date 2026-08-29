import { describe, it, expect } from "vitest";
import { RecallChannel, type RecallSource } from "../src/channels/recall-channel.js";
import type { GraphNode, InstanceId } from "../src/types.js";

/** Minimal fake source: returns fixed nodes, records the call. */
class StubSource implements RecallSource {
  lastCall: { instanceId: InstanceId; keywords: string[]; limit?: number } | null = null;
  neighborCalls: Array<{ instanceId: InstanceId; nodeId: string }> = [];
  constructor(
    private readonly nodes: GraphNode[],
    private readonly neighborsOf: Record<string, GraphNode[]> = {},
  ) {}
  async recall(instanceId: InstanceId, keywords: string[], limit?: number): Promise<GraphNode[]> {
    this.lastCall = { instanceId, keywords, limit };
    return this.nodes;
  }
  async neighbors(instanceId: InstanceId, nodeId: string): Promise<GraphNode[]> {
    this.neighborCalls.push({ instanceId, nodeId });
    return this.neighborsOf[nodeId] ?? [];
  }
}

function node(id: string, label: string, valence = 0): GraphNode {
  return {
    id,
    type: "Entity",
    label,
    instanceId: "x",
    props: {},
    valence,
    valenceSelf: true,
    weight: 1,
    decayed: false,
  };
}

describe("RecallChannel", () => {
  it("extracts keywords from free text and delegates to the source", async () => {
    const src = new StubSource([node("n1", "registry")]);
    const ch = new RecallChannel(src);
    await ch.gather("关于 registry 和 配置的问题", "instA");
    expect(src.lastCall?.instanceId).toBe("instA");
    expect(src.lastCall?.keywords).toContain("registry");
    // Chinese is not whitespace-segmented (v1 has no segmenter), so "配置" stays inside "配置的问题".
    expect(src.lastCall?.keywords.some((k) => k.includes("配置"))).toBe(true);
  });

  it("caps returned contributions to the requested limit", async () => {
    const many = Array.from({ length: 10 }, (_, i) => node(`n${i}`, `label${i}`));
    const src = new StubSource(many);
    const ch = new RecallChannel(src);
    const out = await ch.gather("anything", "instA", 3);
    expect(out.length).toBe(3);
    expect(out.every((c) => c.channel === "recall")).toBe(true);
    // valence carried from node
    expect(out[0].valence).toBe(0);
  });

  it("tags each contribution with a recall seed id", async () => {
    const src = new StubSource([node("n1", "alpha", 0.5)]);
    const ch = new RecallChannel(src);
    const out = await ch.gather("alpha", "instA", 2);
    expect(out[0].seedId.startsWith("recall_n1_")).toBe(true);
    expect(out[0].valence).toBe(0.5);
  });

  it("attaches seed provenance (req_seed_provenance): source node id + selection path", async () => {
    const src = new StubSource([node("n9", "橘猫"), node("n1", "alpha", 0.5)]);
    const ch = new RecallChannel(src);
    const out = await ch.gather("橘猫", "instA", 5);
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.provenance).toBeDefined();
      expect(c.provenance!.source.startsWith("node:")).toBe(true);
      expect(c.provenance!.selectionPath).toMatch(/^recall keyword match rank \d+$/);
      expect(c.provenance!.injectedAt).toBeUndefined(); // stamped later by assemble
    }
  });
});

describe("RecallChannel — dual-mechanism (push-hint pointers vs pull fetch)", () => {
  function nodeWithSummary(id: string, label: string, summary: string): GraphNode {
    return { ...node(id, label), props: { assistantSummary: summary } };
  }

  it("pointers() returns ONLY labels (no full summary), channel 'recall-pointer'", async () => {
    const src = new StubSource([
      nodeWithSummary("n1", "橘猫豆豆", "它是一只爱睡觉的橘猫"),
      nodeWithSummary("n2", "旧相机", "佳能胶片机，偶尔卡带"),
    ]);
    const ch = new RecallChannel(src);
    const ptrs = await ch.pointers("讲讲橘猫和相机", "instA", 5);
    expect(ptrs).toHaveLength(2);
    for (const p of ptrs) {
      expect(p.channel).toBe("recall-pointer");
      expect(p.content).not.toContain("〔"); // no full-summary framing
      expect(p.content).not.toContain("图检索");
    }
    // content is exactly the label — the model reads these as a memory index
    expect(ptrs.map((p) => p.content)).toEqual(["橘猫豆豆", "旧相机"]);
  });

  it("fetch() returns full content (label + summary), channel 'recall'", async () => {
    const src = new StubSource([nodeWithSummary("n1", "橘猫豆豆", "它是一只爱睡觉的橘猫")]);
    const ch = new RecallChannel(src);
    const full = await ch.fetch("橘猫", "instA", 5);
    expect(full).toHaveLength(1);
    expect(full[0].channel).toBe("recall");
    expect(full[0].content).toContain("橘猫豆豆");
    expect(full[0].content).toContain("它是一只爱睡觉的橘猫");
  });

  it("fetchNodes() returns raw GraphNodes (for the memory_recall tool)", async () => {
    const src = new StubSource([nodeWithSummary("n1", "橘猫豆豆", "summary-x")]);
    const ch = new RecallChannel(src);
    const nodes = await ch.fetchNodes("橘猫", "instA", 5);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("n1");
    expect(nodes[0].label).toBe("橘猫豆豆");
  });

  it("gather() is an alias of fetch() (back-compat)", async () => {
    const src = new StubSource([nodeWithSummary("n1", "橘猫豆豆", "summary-x")]);
    const ch = new RecallChannel(src);
    const g = await ch.gather("橘猫", "instA", 2);
    const f = await ch.fetch("橘猫", "instA", 2);
    expect(g).toEqual(f);
  });
});

describe("RecallChannel — relevance ranking (fix: user-named node must surface, not buried)", () => {
  it("ranks the user-named node to the top even when noise nodes were inserted first", async () => {
    // sidecar returns matches in graph-traversal order; without ranking the
    // named node "卷一·不嫁" would be buried. StubSource returns ALL these as
    // "matches" so the ranking is the only thing ordering them.
    const src = new StubSource([
      node("noise1", "新闻分享技巧"), // only a generic kw would match
      node("noise2", "写作方法讨论"),
      node("anchor", "卷一·不嫁"), // label contains 卷一 + 不嫁
      node("noise3", "日常碎片记录"),
    ]);
    const ch = new RecallChannel(src);
    const ptrs = await ch.pointers("你可以帮我给 卷一·不嫁 写个大纲吗", "instA", 5);
    expect(ptrs[0].content).toBe("卷一·不嫁");
  });

  it("fetchNodes() returns ranked nodes (label match first)", async () => {
    const src = new StubSource([
      node("a", "无关背景节点"),
      node("b", "钟无艳小说"),
    ]);
    const ch = new RecallChannel(src);
    const nodes = await ch.fetchNodes("钟无艳小说", "instA", 5);
    expect(nodes[0].label).toBe("钟无艳小说");
  });
});

describe("RecallChannel — 2-hop expansion (§C: surface a named entity's cluster)", () => {
  it("expands the top anchor's neighbors into the pointer list", async () => {
    // Mirrors reality: the keyword only matches the anchor via recall(); the
    // neighbors surface ONLY through the 2-hop neighbors() call (not recall).
    const anchor = node("n_anchor", "卷一·不嫁");
    const neighborA = node("n_neighborA", "钟无艳小说");
    const neighborB = node("n_neighborB", "小说梗概");
    const src = new StubSource([anchor], {
      n_anchor: [neighborA, neighborB],
    });
    const ch = new RecallChannel(src);
    const ptrs = await ch.pointers("卷一·不嫁", "instA", 5);
    const labels = ptrs.map((p) => p.content);
    expect(labels).toContain("卷一·不嫁");
    expect(labels).toContain("钟无艳小说");
    expect(labels).toContain("小说梗概");
    // the anchor's neighbors were pulled via the neighbors() source call
    expect(src.neighborCalls.some((c) => c.nodeId === "n_anchor")).toBe(true);
    // 2-hop entries are tagged in provenance
    expect(ptrs.some((p) => p.provenance?.selectionPath.includes("2-hop"))).toBe(true);
  });

  it("stays safe if the neighbors() source throws (keeps ranked anchors only)", async () => {
    class ThrowingSource implements RecallSource {
      async recall(): Promise<GraphNode[]> {
        return [node("n1", "卷一·不嫁")];
      }
      async neighbors(): Promise<GraphNode[]> {
        throw new Error("sidecar down");
      }
    }
    const ch = new RecallChannel(new ThrowingSource());
    const ptrs = await ch.pointers("卷一·不嫁", "instA", 5);
    expect(ptrs.map((p) => p.content)).toEqual(["卷一·不嫁"]);
  });
});
