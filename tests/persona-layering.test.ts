import { describe, it, expect } from "vitest";
import { resolveCorePersona } from "../src/agent/persona-drift.js";
import { MemoryWriter, HeuristicExtractor } from "../src/memory/writer.js";
import { PersonaSeed } from "../src/memory/persona-seed.js";
import { FakeGraphStore } from "./fake-graph-store.js";
import type { InstanceMeta } from "../src/types.js";

describe("resolveCorePersona (docs/persona-layering.md §3)", () => {
  it("prefers personaCore > persona > fallback", () => {
    const core = "身份锚+红线";
    const ext = "背景故事长文";
    expect(resolveCorePersona({ personaCore: core, personaExt: ext } as InstanceMeta, "FALLBACK")).toBe(core);
    expect(resolveCorePersona({ persona: "旧persona" } as InstanceMeta, "FALLBACK")).toBe("旧persona");
    expect(resolveCorePersona(null, "FALLBACK")).toBe("FALLBACK");
    expect(resolveCorePersona(undefined, "FALLBACK")).toBe("FALLBACK");
  });

  it("never reads personaExt into the injected core (red lines stay out of graph)", () => {
    const meta = { personaCore: "红线：不声明自己是AI", personaExt: "林夏喜欢雨天听歌" } as InstanceMeta;
    // ext 文本不得混入常驻 core（core 只经此函数注入，从不写图）。
    expect(resolveCorePersona(meta, "x")).not.toContain("雨天听歌");
  });
});

describe("MemoryWriter.writePersonaExt (§4, reuses extractor)", () => {
  it("seeds ext nodes and wires each to the persona-identity anchor", async () => {
    const store = new FakeGraphStore();
    const w = new MemoryWriter(store, new HeuristicExtractor());
    const ids = await w.writePersonaExt('背景里提到"橘猫" 和 BetaGamma', "i1", "persona-identity");
    expect(ids.length).toBeGreaterThan(0);
    const anchorEdges = store.allEdges.filter((e) => e.to === "persona-identity");
    expect(anchorEdges.length).toBe(ids.length);
    expect(anchorEdges.every((e) => e.kind === "relates")).toBe(true);
  });

  it("stamps nodes with valenceSelf + instanceId (consistent with writeTurn)", async () => {
    const store = new FakeGraphStore();
    const w = new MemoryWriter(store, new HeuristicExtractor());
    await w.writePersonaExt('提到"foo"', "ix", "persona-identity");
    for (const n of store.allNodes) {
      expect(n.valenceSelf).toBe(true);
      expect(n.instanceId).toBe("ix");
    }
  });
});

describe("PersonaSeed.ensureSeeded (§4, idempotent + safe guard)", () => {
  it("writes anchor + ext once; a second call is a no-op", async () => {
    const store = new FakeGraphStore();
    const writer = new MemoryWriter(store, new HeuristicExtractor());
    const seed = new PersonaSeed(store, writer);
    const ext = '林夏养了橘猫"豆豆"，喜欢雨天听歌';

    await seed.ensureSeeded("i1", ext);
    const anchor1 = store.allNodes.filter((n) => n.props?.kind === "persona-anchor");
    expect(anchor1.length).toBe(1);
    const nodeCount1 = store.allNodes.length;

    await seed.ensureSeeded("i1", ext);
    expect(store.allNodes.filter((n) => n.props?.kind === "persona-anchor").length).toBe(1);
    expect(store.allNodes.length).toBe(nodeCount1); // 不重复 seed ext
  });

  it("is a no-op when ext is empty", async () => {
    const store = new FakeGraphStore();
    const writer = new MemoryWriter(store, new HeuristicExtractor());
    const seed = new PersonaSeed(store, writer);
    await seed.ensureSeeded("i2", undefined);
    expect(store.allNodes.length).toBe(0);
  });

  it("wires seeded ext nodes to the anchor (graph recall can reach them via the anchor)", async () => {
    const store = new FakeGraphStore();
    const writer = new MemoryWriter(store, new HeuristicExtractor());
    const seed = new PersonaSeed(store, writer);
    await seed.ensureSeeded("i3", '林夏的朋友叫"小满"');
    const anchor = store.allNodes.find((n) => n.props?.kind === "persona-anchor");
    expect(anchor).toBeTruthy();
    const edgesToAnchor = store.allEdges.filter((e) => e.to === anchor!.id);
    expect(edgesToAnchor.length).toBeGreaterThan(0);
  });
});
