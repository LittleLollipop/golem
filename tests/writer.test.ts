import { describe, it, expect } from "vitest";
import { MemoryWriter, HeuristicValence, HeuristicExtractor } from "../src/memory/writer.js";
import { FakeGraphStore } from "./fake-graph-store.js";

describe("MemoryWriter", () => {
  it("persists an Event node + Entity nodes extracted from a turn", async () => {
    const store = new FakeGraphStore();
    const w = new MemoryWriter(store);
    await w.writeTurn({
      instanceId: "i1",
      userText: '他说"测试" 又提到 AlphaBeta',
      assistantText: "ok",
      timestamp: 1000,
    });

    // 1 Event + Entity("测试") from the quoted span + Entity("AlphaBeta") from the capitalized word
    expect(store.allNodes.length).toBe(3);
    const entLabels = store.allNodes.filter((n) => n.type === "Entity").map((n) => n.label);
    expect(entLabels).toContain("测试");
    expect(entLabels).toContain("AlphaBeta");
    const evt = store.allNodes.find((n) => n.type === "Event");
    expect(evt).toBeTruthy();
    expect(store.allEdges.some((e) => e.kind === "relates")).toBe(true);
  });

  it("marks every node valenceSelf=true and stamps instanceId", async () => {
    const store = new FakeGraphStore();
    const w = new MemoryWriter(store);
    await w.writeTurn({ instanceId: "ix", userText: '提到"foo"', assistantText: "y", timestamp: 1 });
    for (const n of store.allNodes) {
      expect(n.valenceSelf).toBe(true);
      expect(n.instanceId).toBe("ix");
      expect(typeof n.valence).toBe("number");
    }
  });

  it("HeuristicValence yields positive/negative/neutral 4-dim vectors", () => {
    const v = new HeuristicValence();
    expect(v.estimate("我喜欢这个 很开心").praise).toBeGreaterThan(0);
    expect(v.estimate("我讨厌这个 很焦虑").blame).toBeGreaterThan(0);
    expect(v.estimate("中性内容")).toEqual({ praise: 0, blame: 0, fear: 0, attachment: 0 });
  });

  it("writeTurn stores valenceVec + derived scalar valence", async () => {
    const store = new FakeGraphStore();
    const w = new MemoryWriter(store);
    await w.writeTurn({ instanceId: "ix", userText: '提到"foo"', assistantText: "y", timestamp: 1 });
    for (const n of store.allNodes) {
      expect(n.valenceVec).toBeDefined();
      expect(typeof n.valence).toBe("number");
    }
  });

  it("HeuristicExtractor extracts Event + quoted/capitalized entities", () => {
    const ex = new HeuristicExtractor();
    const { nodes, edges } = ex.extract({ instanceId: "i", userText: '聊了"项目" 和 BetaGamma', assistantText: "x", timestamp: 5 });
    const types = nodes.map((n) => n.type);
    expect(types).toContain("Event");
    expect(types).toContain("Entity");
    expect(edges.every((e) => e.kind === "relates")).toBe(true);
  });
});
