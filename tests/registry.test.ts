import { describe, it, expect } from "vitest";
import { InstanceRegistry } from "../src/registry/instance-registry.js";
import { FakeGraphStore } from "./fake-graph-store.js";

function makeReg() {
  const store = new FakeGraphStore();
  return { reg: new InstanceRegistry(store), store };
}

describe("InstanceRegistry (维度 I)", () => {
  it("create ensures an instance graph and lists it", async () => {
    const { reg, store } = makeReg();
    const meta = await reg.create("A", "假人A");
    expect(meta.id).toBe("A");
    expect(store.hasInstance("A")).toBe(true);
    expect(await reg.list()).toHaveLength(1);
  });

  it("rejects mid-session instance switch (no-mid-switch)", async () => {
    const { reg } = makeReg();
    await reg.create("A", "假人A");
    await reg.create("B", "假人B");
    await reg.select("sess1", "A");
    // switching to B mid-session must throw
    await expect(reg.select("sess1", "B")).rejects.toThrow(/no-mid-switch/);
    // re-selecting the same instance is allowed
    await expect(reg.select("sess1", "A")).resolves.toBeUndefined();
  });

  it("touch increments the instance turn counter", async () => {
    const { reg } = makeReg();
    await reg.create("A", "假人A");
    await reg.select("sess1", "A");
    await reg.touch("sess1");
    const meta = (await reg.list()).find((m) => m.id === "A")!;
    expect(meta.turns).toBe(1);
  });

  it("assertStable throws only on real drift", async () => {
    const { reg } = makeReg();
    await reg.create("A", "假人A");
    await reg.select("sess1", "A");
    await expect(reg.assertStable("sess1", "A")).resolves.toBeUndefined();
    await expect(reg.assertStable("sess1", "OTHER")).rejects.toThrow(/no-mid-switch/);
  });
});
