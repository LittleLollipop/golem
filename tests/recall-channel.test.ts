import { describe, it, expect } from "vitest";
import { RecallChannel, type RecallSource } from "../src/channels/recall-channel.js";
import type { GraphNode, InstanceId } from "../src/types.js";

/** Minimal fake source: returns fixed nodes, records the call. */
class StubSource implements RecallSource {
  lastCall: { instanceId: InstanceId; keywords: string[]; limit?: number } | null = null;
  constructor(private readonly nodes: GraphNode[]) {}
  async recall(instanceId: InstanceId, keywords: string[], limit?: number): Promise<GraphNode[]> {
    this.lastCall = { instanceId, keywords, limit };
    return this.nodes;
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
});
