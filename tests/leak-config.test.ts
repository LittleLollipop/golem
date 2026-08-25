import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadLeakConfig } from "../src/leak/config.js";
import { DriftChannel } from "../src/channels/drift-channel.js";
import { AmbientBuffer } from "../src/ambient/ambient-buffer.js";
import type { MemoryReader } from "../src/memory/reader.js";
import type { DshAdapter } from "../src/adapter/dsh-seams.js";
import type { InstanceRegistry } from "../src/registry/instance-registry.js";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("loadLeakConfig (req_leak_rate_tunable)", () => {
  it("reads all leak-rate knobs from env, with sane defaults", () => {
    process.env.FAKEREN_LEAK_MAX = "5";
    process.env.FAKEREN_LEAK_DRIFT = "4";
    process.env.FAKEREN_LEAK_AMBIENT = "3";
    process.env.FAKEREN_LEAK_L05 = "2";
    process.env.FAKEREN_LEAK_TRIGGER_P = "0.5";
    process.env.FAKEREN_LEAK_MIN_VALENCE = "0.3";
    const c = loadLeakConfig();
    expect(c).toMatchObject({
      maxSeeds: 5,
      driftLimit: 4,
      ambientLimit: 3,
      l05Limit: 2,
      triggerProbability: 0.5,
      minValence: 0.3,
    });
  });

  it("defaults when env unset", () => {
    delete process.env.FAKEREN_LEAK_MAX;
    delete process.env.FAKEREN_LEAK_DRIFT;
    delete process.env.FAKEREN_LEAK_AMBIENT;
    delete process.env.FAKEREN_LEAK_L05;
    delete process.env.FAKEREN_LEAK_TRIGGER_P;
    delete process.env.FAKEREN_LEAK_MIN_VALENCE;
    const c = loadLeakConfig();
    expect(c.maxSeeds).toBe(0); // uncapped
    expect(c.driftLimit).toBe(3);
    expect(c.ambientLimit).toBe(2);
    expect(c.l05Limit).toBe(2);
    expect(c.triggerProbability).toBe(1);
    expect(c.minValence).toBe(0);
  });
});

function edge(from: string, to: string, valence: number, decayed = false) {
  return { from, to, props: { valence, decayed } };
}

const readerStub = {
  crossDomain: async () => [
    edge("a", "b", 0.9),
    edge("c", "d", 0.2),
    edge("e", "f", 0.5, true), // decayed → always skipped
  ],
} as unknown as MemoryReader;
const persistStub = { loadSessionEvents: async () => [] } as unknown as DshAdapter;
const regStub = { sessionsOf: async () => [] } as unknown as InstanceRegistry;

describe("DriftChannel honors externalized leak config (req_leak_rate_tunable)", () => {
  it("driftLimit caps cross-domain seeds", async () => {
    const ch = new DriftChannel(readerStub, persistStub, regStub, undefined, undefined, {
      maxSeeds: 0, driftLimit: 1, ambientLimit: 0, l05Limit: 0, triggerProbability: 1, minValence: 0,
    });
    const out = await ch.gather("i");
    const xd = out.filter((c) => c.content.startsWith("[跨域联想]"));
    expect(xd).toHaveLength(1);
    expect(xd[0].content).toContain("a ↔ b");
  });

  it("ambientLimit caps ambient seeds", async () => {
    const buf = new AmbientBuffer(8, 0, 1);
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "x", features: { summary: "光" } }, observationText: "光", at: Date.now() });
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "y", features: { summary: "影" } }, observationText: "影", at: Date.now() });
    const ch = new DriftChannel(readerStub, persistStub, regStub, buf, undefined, {
      maxSeeds: 0, driftLimit: 0, ambientLimit: 1, l05Limit: 0, triggerProbability: 1, minValence: 0,
    });
    const out = await ch.gather("i");
    const amb = out.filter((c) => c.content.startsWith("[环境]"));
    expect(amb).toHaveLength(1);
  });

  it("maxSeeds caps the overall seed count", async () => {
    const buf = new AmbientBuffer(8, 0, 1);
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "x", features: { summary: "光" } }, observationText: "光", at: Date.now() });
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "y", features: { summary: "影" } }, observationText: "影", at: Date.now() });
    const ch = new DriftChannel(readerStub, persistStub, regStub, buf, undefined, {
      maxSeeds: 2, driftLimit: 5, ambientLimit: 5, l05Limit: 0, triggerProbability: 1, minValence: 0,
    });
    const out = await ch.gather("i");
    expect(out.length).toBe(2); // drift(2 non-decayed) + ambient(2) would be 4, capped to 2
  });

  it("minValence drops low-weight drift seeds", async () => {
    const ch = new DriftChannel(readerStub, persistStub, regStub, undefined, undefined, {
      maxSeeds: 0, driftLimit: 5, ambientLimit: 0, l05Limit: 0, triggerProbability: 1, minValence: 0.5,
    });
    const out = await ch.gather("i");
    const xd = out.filter((c) => c.content.startsWith("[跨域联想]"));
    // a↔b (0.9) survives; c↔d (0.2) dropped by valence floor
    expect(xd).toHaveLength(1);
    expect(xd[0].content).toContain("a ↔ b");
  });

  it("triggerProbability=0 suppresses ALL leakage", async () => {
    const buf = new AmbientBuffer(8, 0, 1);
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "x", features: { summary: "光" } }, observationText: "光", at: Date.now() });
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const ch = new DriftChannel(readerStub, persistStub, regStub, buf, undefined, {
      maxSeeds: 0, driftLimit: 5, ambientLimit: 5, l05Limit: 5, triggerProbability: 0, minValence: 0,
    });
    const out = await ch.gather("i");
    expect(out).toHaveLength(0);
    spy.mockRestore();
  });
});
