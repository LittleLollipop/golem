import { describe, it, expect } from "vitest";
import { Consolidator } from "../src/memory/consolidator.js";
import { FakeGraphStore } from "./fake-graph-store.js";

describe("Consolidator", () => {
  it("run() forwards to store.consolidate with the configured budget", async () => {
    const store = new FakeGraphStore();
    const c = new Consolidator(store, 42);
    const rep = await c.run("i3");
    expect(store.lastConsolidate).toEqual({ instanceId: "i3", budget: 42 });
    expect(rep.instanceId).toBe("i3");
  });
});
