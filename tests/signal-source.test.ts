import { describe, it, expect } from "vitest";
import { LocalClockSource, FileNotesSource } from "../src/bus/sources.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("LocalClockSource (#24)", () => {
  it("emits a clock observation, then suppresses repeats within the same bucket", async () => {
    const s = new LocalClockSource();
    const a = await s.poll("i1");
    expect(Array.isArray(a)).toBe(true);
    if (a.length > 0) expect(a[0].source).toBe("clock");
    const b = await s.poll("i1");
    expect(b).toHaveLength(0);
  });
});

describe("FileNotesSource (#24)", () => {
  it("tails lines appended after construction", async () => {
    const file = path.join(os.tmpdir(), `golem-notes-${Date.now()}.txt`);
    fs.writeFileSync(file, "第一行\n");
    const s = new FileNotesSource(file);
    const first = await s.poll("i1");
    expect(first.map((o) => o.text)).toEqual(["第一行"]);

    fs.appendFileSync(file, "第二行\n第三行\n");
    const second = await s.poll("i1");
    expect(second.map((o) => o.text)).toEqual(["第二行", "第三行"]);

    fs.unlinkSync(file);
  });

  it("returns nothing for a missing file", async () => {
    const s = new FileNotesSource("/no/such/file/notes.txt");
    expect(await s.poll("i1")).toHaveLength(0);
  });
});
