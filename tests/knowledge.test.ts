import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";
import { KnowledgeSourceRegistry } from "../src/knowledge/registry.js";
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
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-l05-"));
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

describe("DailyKnowledgeTracker dual-track (req_l05_knowledge_trajectory)", () => {
  it("random slot learns top1 on day 1, top2 the next day (shared dedup)", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      tmpdir,
      undefined,
      clock.now,
    );
    const d1 = (await tr.ensureToday("instA")).random!;
    expect(d1.chosenRank).toBe(1);
    expect(d1.selectionPath).toContain("随机选");
    expect(d1.sourceUrl).toContain("http");

    // same day again → quota spent
    expect((await tr.ensureToday("instA")).random).toBeUndefined();

    // next day → top2 (top1 already learned)
    clock.advanceDays(1);
    const d2 = (await tr.ensureToday("instA")).random!;
    expect(d2.chosenRank).toBe(2);
    expect(d2.selectionPath).toContain("rank 2");
  });

  it("is per-instance isolated (req_iso_learning_scoped)", async () => {
    const clock = makeClock();
    const mk = () =>
      new DailyKnowledgeTracker(
        new StaticKnowledgeSource(),
        new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
        tmpdir,
        undefined,
        clock.now,
      );
    const a = (await mk().ensureToday("A")).random!;
    const b = (await mk().ensureToday("B")).random!;
    expect(a.chosenRank).toBe(1);
    expect(b.chosenRank).toBe(1); // B has its own fresh ledger
  });

  it("random slot records 'empty' once every candidate is learned", async () => {
    const clock = makeClock();
    const tr = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      tmpdir,
      undefined,
      clock.now,
    );
    for (let i = 0; i < 6; i++) {
      const r = (await tr.ensureToday("X")).random!;
      expect(r.status).toBe("learned");
      clock.advanceDays(1);
    }
    clock.advanceDays(1);
    const r = await tr.ensureToday("X");
    expect(r.random?.status).toBe("empty"); // all 6 learned → no new random content
  });

  it("persists the ledger to disk (a fresh tracker remembers learned ids)", async () => {
    const clock = makeClock();
    const tr1 = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      tmpdir,
      undefined,
      clock.now,
    );
    await tr1.ensureToday("P");
    clock.advanceDays(1);
    const tr2 = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      tmpdir,
      undefined,
      clock.now,
    );
    const d2 = (await tr2.ensureToday("P")).random!; // persisted ledger → must pick top2
    expect(d2.chosenRank).toBe(2);
  });
});

describe("L05Trajectory (req_l05 drift seeds)", () => {
  it("tick ensures today's slots; seedCandidates carries citation + selection path", async () => {
    const tr = new DailyKnowledgeTracker(
      new StaticKnowledgeSource(),
      new KnowledgeSourceRegistry({ static: new StaticKnowledgeSource() }, "static"),
      tmpdir,
    );
    const l05 = new L05Trajectory(tr);
    const res = await l05.tick("instA");
    expect(res?.random).not.toBeUndefined();
    const seeds = l05.seedCandidates("instA", 4);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds[0].observationText).toContain("来源");
    expect(seeds[0].seedId).toBe(`l05_${res!.random!.id}`);
    expect(seeds[0].meta?.sourceUrl).toBe(res!.random!.sourceUrl);
    expect(seeds[0].provenance?.selectionPath).toBe(res!.random!.selectionPath);
  });
});
