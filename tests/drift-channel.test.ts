import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DriftChannel } from "../src/channels/drift-channel.js";
import { AmbientBuffer } from "../src/ambient/ambient-buffer.js";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";
import { KnowledgeSourceRegistry } from "../src/knowledge/registry.js";
import { DailyKnowledgeTracker } from "../src/knowledge/daily-tracker.js";
import { L05Trajectory } from "../src/knowledge/l05-trajectory.js";
import type { MemoryReader } from "../src/memory/reader.js";
import type { DshAdapter } from "../src/adapter/dsh-seams.js";
import type { InstanceRegistry } from "../src/registry/instance-registry.js";

// Minimal stubs: no cross-domain edges, no history, no sessions — isolate the
// ambient-seed path.
const stubReader = { crossDomain: async () => [] } as unknown as MemoryReader;
const stubPersist = { loadSessionEvents: async () => [] } as unknown as DshAdapter;
const stubRegistry = { sessionsOf: async () => [] } as unknown as InstanceRegistry;

describe("DriftChannel ambient integration (req_ambient_decay_stream)", () => {
  it("surfaces fresh ambient samples as drift seeds and excludes stale ones", async () => {
    const buf = new AmbientBuffer(8, 0, 1000); // halfLife 1s
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "a", features: { summary: "窗边有光" } }, observationText: "窗边有光", at: Date.now() });
    buf.push({ sample: { kind: "image", capturedAt: Date.now() - 10000, localPath: "b", features: { summary: "昨天的房间" } }, observationText: "昨天的房间", at: Date.now() - 10000 });
    const ch = new DriftChannel(stubReader, stubPersist, stubRegistry, buf);
    const out = await ch.gather("instA");
    const ambientOnes = out.filter((c) => c.content.startsWith("[环境]"));
    // only the fresh one survives decay
    expect(ambientOnes).toHaveLength(1);
    expect(ambientOnes[0].content).toContain("窗边有光");
    expect(ambientOnes[0].seedId).toContain("ambient_");
    expect(ambientOnes[0].channel).toBe("drift");
    // 种子溯源 (req_seed_provenance)：环境样本来源 + 选择路径（注入时机由 assemble 盖章）
    expect(ambientOnes[0].provenance?.source?.startsWith("sample:")).toBe(true);
    expect(ambientOnes[0].provenance?.selectionPath).toMatch(/^ambient image fresh weight /);
    expect(ambientOnes[0].provenance?.injectedAt).toBeUndefined();
  });

  it("emits no ambient contribution when no buffer is wired", async () => {
    const ch = new DriftChannel(stubReader, stubPersist, stubRegistry);
    const out = await ch.gather("instA");
    expect(out.filter((c) => c.content.startsWith("[环境]"))).toHaveLength(0);
  });
});

describe("DriftChannel L0.5 knowledge trajectory (req_l05_knowledge_trajectory)", () => {
  it("surfaces recent learned facts as [知识轨迹] drift seeds with citation meta", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-l05-int-"));
    const tr = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      dir,
    );
    const l05 = new L05Trajectory(tr);
    const learned = (await l05.tick("instA"))?.random; // random slot learns top1
    const ch = new DriftChannel(stubReader, stubPersist, stubRegistry, undefined, l05);
    const out = await ch.gather("instA");
    const k = out.filter((c) => c.content.startsWith("[知识轨迹]"));
    expect(k).toHaveLength(1);
    // keyword-only pointer: visible text is the title, NOT the summary+source
    expect(k[0].content).toContain(learned!.title);
    expect(k[0].content).not.toContain("来源");
    expect(k[0].content).not.toContain(learned!.summary);
    expect(k[0].meta).toMatchObject({ chosenRank: 1, selectionPath: "随机选 (rank 1, 来源 Wikipedia)" });
    // 种子溯源 (req_seed_provenance)：L0.5 来源 URL + 选择路径已挂到 provenance
    expect(k[0].provenance?.source).toMatch(/^https?:\/\//);
    expect(k[0].provenance?.selectionPath).toBe("随机选 (rank 1, 来源 Wikipedia)");
    expect(k[0].provenance?.injectedAt).toBeUndefined();
    expect(learned).not.toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
