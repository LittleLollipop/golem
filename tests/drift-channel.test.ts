import { describe, it, expect } from "vitest";
import { DriftChannel } from "../src/channels/drift-channel.js";
import { AmbientBuffer } from "../src/ambient/ambient-buffer.js";
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
  });

  it("emits no ambient contribution when no buffer is wired", async () => {
    const ch = new DriftChannel(stubReader, stubPersist, stubRegistry);
    const out = await ch.gather("instA");
    expect(out.filter((c) => c.content.startsWith("[环境]"))).toHaveLength(0);
  });
});
