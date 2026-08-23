import { describe, it, expect } from "vitest";
import { MemoryReader } from "../src/memory/reader.js";
import { FakeGraphStore } from "./fake-graph-store.js";

describe("MemoryReader", () => {
  it("recall delegates to store.recall with instanceId + keywords", async () => {
    const store = new FakeGraphStore();
    const r = new MemoryReader(store);
    const out = await r.recall("i9", ["foo", "bar"], undefined, 7);
    expect(store.recallCalls.length).toBe(1);
    expect(store.recallCalls[0].instanceId).toBe("i9");
    expect(store.recallCalls[0].keywords).toEqual(["foo", "bar"]);
    expect(store.recallCalls[0].limit).toBe(7);
    expect(out).toEqual([]);
  });

  it("crossDomain delegates to store.queryCrossDomain", async () => {
    const store = new FakeGraphStore();
    const r = new MemoryReader(store);
    const out = await r.crossDomain("i9", 50);
    expect(out).toEqual([]);
  });
});
