import { describe, it, expect } from "vitest";
import {
  parseLeakConfig,
  parseSeedLine,
  lastSeedsFromLog,
  listLedgerInstances,
} from "../scripts/inspect-core.mjs";

const SEED_LINE =
  '[fakeren:pre-step]   seed drift_xd_喜欢在雨天独处听歌_对陌生环境有警惕心 [drift] src=edge:喜欢在雨天独处听歌->对陌生环境有警惕心 path="crossDomain by |valence| rank 1 (valence 0)" at=2026-08-25T12:13:12.720Z';

describe("inspect CLI core (req_inspect_cli)", () => {
  describe("parseSeedLine", () => {
    it("parses a real provenance log line into id/channel/source/path/at", () => {
      const s = parseSeedLine(SEED_LINE);
      expect(s).not.toBeNull();
      expect(s!.id).toBe("drift_xd_喜欢在雨天独处听歌_对陌生环境有警惕心");
      expect(s!.channel).toBe("drift");
      expect(s!.source).toBe("edge:喜欢在雨天独处听歌->对陌生环境有警惕心");
      expect(s!.selectionPath).toBe("crossDomain by |valence| rank 1 (valence 0)");
      expect(s!.at).toBe("2026-08-25T12:13:12.720Z");
    });

    it("returns null for non-seed log lines", () => {
      expect(parseSeedLine("[fakeren:pre-step] exit leaked=1")).toBeNull();
      expect(parseSeedLine("")).toBeNull();
      expect(parseSeedLine(undefined)).toBeNull();
    });
  });

  describe("lastSeedsFromLog", () => {
    it("returns the most recent n seed records in order", () => {
      const log = [
        "[fakeren:pre-step] enter session=s claimed=1",
        SEED_LINE,
        '[fakeren:pre-step]   seed recall_n_cat_0 [recall] src=node:n_cat path="recall keyword match rank 1" at=2026-08-25T12:13:12.721Z',
        "[fakeren:pre-step] exit leaked=2",
      ].join("\n");
      const seeds = lastSeedsFromLog(log, 20);
      expect(seeds).toHaveLength(2);
      expect(seeds[0].channel).toBe("drift");
      expect(seeds[1].channel).toBe("recall");
      // n=1 → only the most recent
      expect(lastSeedsFromLog(log, 1)).toHaveLength(1);
      expect(lastSeedsFromLog(log, 1)[0].channel).toBe("recall");
    });

    it("returns [] for empty/missing log", () => {
      expect(lastSeedsFromLog("")).toEqual([]);
      expect(lastSeedsFromLog(undefined)).toEqual([]);
    });
  });

  describe("parseLeakConfig", () => {
    it("returns documented defaults when env is absent", () => {
      const cfg = parseLeakConfig({});
      expect(cfg).toEqual({
        maxSeeds: 0,
        driftLimit: 3,
        ambientLimit: 2,
        l05Limit: 2,
        triggerProbability: 1,
        minValence: 0,
      });
    });

    it("reads FAKEREN_LEAK_* env overrides", () => {
      const cfg = parseLeakConfig({
        FAKEREN_LEAK_MAX: "5",
        FAKEREN_LEAK_DRIFT: "4",
        FAKEREN_LEAK_AMBIENT: "1",
        FAKEREN_LEAK_L05: "3",
        FAKEREN_LEAK_TRIGGER_P: "0.5",
        FAKEREN_LEAK_MIN_VALENCE: "0.2",
      });
      expect(cfg.maxSeeds).toBe(5);
      expect(cfg.driftLimit).toBe(4);
      expect(cfg.ambientLimit).toBe(1);
      expect(cfg.l05Limit).toBe(3);
      expect(cfg.triggerProbability).toBe(0.5);
      expect(cfg.minValence).toBe(0.2);
    });

    it("clamps out-of-range trigger probability back to 1", () => {
      expect(parseLeakConfig({ FAKEREN_LEAK_TRIGGER_P: "2" }).triggerProbability).toBe(1);
      expect(parseLeakConfig({ FAKEREN_LEAK_TRIGGER_P: "-1" }).triggerProbability).toBe(1);
    });
  });

  describe("listLedgerInstances", () => {
    it("lists instance ids from .json ledger files", () => {
      const fake = (dir: string) => [`default.json`, `alt.json`, `notes.txt`].filter((f) => f.endsWith(".json"));
      expect(listLedgerInstances("/x", fake as any)).toEqual(["default", "alt"]);
    });
    it("returns [] on missing dir", () => {
      const fake = (dir: string) => {
        throw new Error("ENOENT");
      };
      expect(listLedgerInstances("/nope", fake as any)).toEqual([]);
    });
  });
});
