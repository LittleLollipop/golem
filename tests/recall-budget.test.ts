import { describe, it, expect } from "vitest";
import { RecallBudget } from "../src/recall-budget.js";

describe("RecallBudget (per-turn guard for memory_recall)", () => {
  it("allows up to the per-turn limit, then returns -1", () => {
    const b = new RecallBudget(3);
    expect(b.tryConsume("s1")).toBe(2);
    expect(b.tryConsume("s1")).toBe(1);
    expect(b.tryConsume("s1")).toBe(0);
    expect(b.tryConsume("s1")).toBe(-1); // exhausted
    expect(b.tryConsume("s1")).toBe(-1); // stays exhausted
  });

  it("reset restores the full allowance for a session", () => {
    const b = new RecallBudget(3);
    b.tryConsume("s1");
    b.tryConsume("s1");
    b.reset("s1");
    expect(b.tryConsume("s1")).toBe(2);
  });

  it("budget is keyed per session (independent counters)", () => {
    const b = new RecallBudget(1);
    expect(b.tryConsume("a")).toBe(0);
    expect(b.tryConsume("b")).toBe(0); // different key → fresh allowance
    expect(b.tryConsume("a")).toBe(-1); // first key exhausted
  });
});
