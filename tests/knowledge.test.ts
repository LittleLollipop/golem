import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";
import { DailyKnowledgeTracker } from "../src/knowledge/daily-tracker.js";
import { L05Trajectory } from "../src/knowledge/l05-trajectory.js";

/** Deterministic clock so tests can advance the calendar day. */
function makeClock(start = new Date("2026-08-25T09:00:00")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advanceDays: (d: number) => {
      t += d * 24 * 3600 * 1000;
    },
  };
}

let tmpdir: string;
beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "fakeren-l05-"));
});
afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe("StaticKnowledgeSource", () => {
  it("returns candidates in ascending rank order with real citations", async () => {
    const c = await new StaticKnowledgeSource().rankedCandidates();
    expect(c.length).toBeGreaterThan(1);
    for (let i = 1; i < c.length; i++) expect(c[i].rank).toBeGreaterThan(c[i - 1].rank);
    expect(c[0].sourceUrl).toContain("http");
  });
});

describe("DailyKnowledgeTracker (req_l05_knowledge_trajectory)", () => {
  it("learns top1 on day 1, nothing more that same day, then top2 the next day", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    const d1 = await tr.learnOne("instA");
    expect(d1).not.toBeNull();
    expect(d1!.chosenRank).toBe(1);
    expect(d1!.selectionPath).toBe("选 top1 (rank 1)");
    expect(d1!.sourceUrl).toContain("http");

    // same day again → quota spent
    expect(await tr.learnOne("instA")).toBeNull();

    // next day → top2 (top1 already learned)
    clock.advanceDays(1);
    const d2 = await tr.learnOne("instA");
    expect(d2).not.toBeNull();
    expect(d2!.chosenRank).toBe(2);
    expect(d2!.selectionPath).toBe("top1 已学过 → 选 rank 2");
  });

  it("is per-instance isolated (req_iso_learning_scoped)", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    const a = await tr.learnOne("A");
    const b = await tr.learnOne("B");
    expect(a!.chosenRank).toBe(1);
    expect(b!.chosenRank).toBe(1); // B has its own fresh ledger
  });

  it("returns null once every candidate is learned", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    for (let i = 0; i < 6; i++) {
      const f = await tr.learnOne("X");
      expect(f).not.toBeNull();
      clock.advanceDays(1);
    }
    clock.advanceDays(1);
    expect(await tr.learnOne("X")).toBeNull();
  });

  it("persists the ledger to disk (a fresh tracker instance remembers learned ids)", async () => {
    const clock = makeClock();
    const tr1 = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    await tr1.learnOne("P");
    clock.advanceDays(1);
    const tr2 = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    const d2 = await tr2.learnOne("P"); // persisted ledger → must pick top2
    expect(d2!.chosenRank).toBe(2);
  });
});

describe("L05Trajectory (req_l05 drift seeds)", () => {
  it("tick learns the daily fact; seedCandidates carries citation + selection path", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(new StaticKnowledgeSource(), tmpdir, clock.now);
    const l05 = new L05Trajectory(tr);
    const learned = await l05.tick("instA");
    expect(learned).not.toBeNull();
    const seeds = l05.seedCandidates("instA", 2);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].observationText).toContain("来源");
    expect(seeds[0].seedId).toBe(`l05_${learned!.id}`);
    expect(seeds[0].meta?.sourceUrl).toBe(learned!.sourceUrl);
    expect(seeds[0].meta?.selectionPath).toBe(learned!.selectionPath);
  });
});
