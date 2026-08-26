import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundTaskLog } from "../src/scheduler/background-log.js";
import { L05Trajectory } from "../src/knowledge/l05-trajectory.js";
import { DailyKnowledgeTracker } from "../src/knowledge/daily-tracker.js";
import { StaticKnowledgeSource } from "../src/knowledge/static-source.js";
import { DriftChannel } from "../src/channels/drift-channel.js";
import type { MemoryReader } from "../src/memory/reader.js";
import type { DshAdapter } from "../src/adapter/dsh-seams.js";
import type { InstanceRegistry } from "../src/registry/instance-registry.js";
import type { AmbientBuffer } from "../src/ambient/ambient-buffer.js";
import type { L05Trajectory as L05 } from "../src/knowledge/l05-trajectory.js";
import type { BackgroundTaskLog as BTL } from "../src/scheduler/background-log.js";

let dir: string;
function tmpLogPath(): string {
  return join(dir, "scheduler.log");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fak-sched-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BackgroundTaskLog core", () => {
  it("appends learn/refresh/drift and reads them back in order", () => {
    const log = new BackgroundTaskLog(tmpLogPath());
    const t = new Date("2026-08-27T00:00:00Z");
    log.learn("instA", { id: "f1", title: "光合作用", chosenRank: 1, selectionPath: "选 top1 (rank 1)" }, t);
    log.refresh("global", 3, new Date(t.getTime() + 1000));
    log.drift("instA", 4, { xd: 1, hist: 1, ambient: 1, l05: 1 }, new Date(t.getTime() + 2000));

    const events = log.read();
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe("learn");
    expect(events[0].instanceId).toBe("instA");
    expect(events[0].detail).toMatchObject({ title: "光合作用", chosenRank: 1 });
    expect(events[1].kind).toBe("refresh");
    expect(events[1].detail).toMatchObject({ drewCount: 3 });
    expect(events[2].kind).toBe("drift");
    expect(events[2].detail).toMatchObject({ total: 4, bySource: { xd: 1, ambient: 1 } });
  });

  it("returns [] when the log file does not exist", () => {
    const log = new BackgroundTaskLog(join(dir, "absent.log"));
    expect(log.read()).toEqual([]);
  });

  it("respects the limit argument (most recent only)", () => {
    const log = new BackgroundTaskLog(tmpLogPath());
    for (let i = 0; i < 5; i++) {
      log.refresh("global", i, new Date(1_000 + i));
    }
    const all = log.read();
    expect(all).toHaveLength(5);
    expect(log.read(2)).toHaveLength(2);
    expect(log.read(2)[1].detail.drewCount).toBe(4);
  });
});

describe("L05Trajectory wiring", () => {
  it("logs a learn event when tick learns a new fact", async () => {
    const log = new BackgroundTaskLog(tmpLogPath());
    const tracker = new DailyKnowledgeTracker(new StaticKnowledgeSource(), dir);
    const l05: L05 = new L05Trajectory(tracker, 7, log);

    const fact = await l05.tick("instA");
    expect(fact).not.toBeNull();

    const events = log.read();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("learn");
    expect(events[0].instanceId).toBe("instA");
    expect(events[0].detail.title).toBe(fact!.title);
    expect(events[0].detail.chosenRank).toBe(fact!.chosenRank);
  });

  it("does NOT write when no log is injected (hermetic default)", async () => {
    const tracker = new DailyKnowledgeTracker(new StaticKnowledgeSource(), dir);
    const l05 = new L05Trajectory(tracker);
    await l05.tick("instA");
    expect(existsSync(tmpLogPath())).toBe(false);
  });
});

describe("DriftChannel wiring", () => {
  it("logs a drift event with per-source counts", async () => {
    const log = new BackgroundTaskLog(tmpLogPath());
    const reader = {
      crossDomain: async () => [
        { from: "a", to: "b", props: { valence: 0.9 } },
      ],
    } as unknown as MemoryReader;
    const dsh = { loadSessionEvents: async () => [] } as unknown as DshAdapter;
    const registry = { sessionsOf: async () => ["s1"] } as unknown as InstanceRegistry;
    const ambient = undefined as unknown as AmbientBuffer;
    const l05 = undefined as unknown as L05;
    const drift = new DriftChannel(reader, dsh, registry, ambient, l05, undefined, log);

    const out = await drift.gather("instA", 3);
    expect(out.length).toBeGreaterThan(0);

    const events = log.read();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("drift");
    expect(events[0].instanceId).toBe("instA");
    expect(events[0].detail.total).toBe(out.length);
    expect((events[0].detail.bySource as any).xd).toBeGreaterThanOrEqual(1);
  });
});

// ambient refresh wiring is covered end-to-end by the daemon smoke test in the
// build pipeline (refresh() is called by the background timer); here we assert
// the contract the source calls: log.refresh(global, n) records a refresh event.
describe("ambient refresh contract", () => {
  it("BackgroundTaskLog.refresh records the global draw count", () => {
    const log: BTL = new BackgroundTaskLog(tmpLogPath());
    log.refresh("global", 2, new Date("2026-08-27T01:00:00Z"));
    const events = log.read();
    expect(events[0].kind).toBe("refresh");
    expect(events[0].instanceId).toBe("global");
    expect(events[0].detail.drewCount).toBe(2);
    // sanity: file on disk contains valid JSONL
    const lines = readFileSync(tmpLogPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).kind).toBe("refresh");
  });
});
