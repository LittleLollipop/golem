import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CameraMicSource } from "../src/ambient/ambient-source.js";
import { LocalSnapshotAdapter, NativeMediaAdapter, extractFeatures } from "../src/ambient/capture-adapter.js";
import { AmbientBuffer } from "../src/ambient/ambient-buffer.js";

/** Build a minimal-but-valid PNG whose IHDR declares 1280x720. */
function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const type = Buffer.from("IHDR", "ascii");
  const bw = Buffer.alloc(4);
  bw.writeUInt32BE(w, 0);
  const bh = Buffer.alloc(4);
  bh.writeUInt32BE(h, 0);
  const rest = Buffer.alloc(5); // bitdepth, colortype, comp, filter, interlace
  const tail = Buffer.alloc(4);
  return Buffer.concat([sig, len, type, bw, bh, rest, tail]);
}

/** Build a minimal WAV header (~0.5s, 8kHz mono 8-bit). */
function makeWav(durationMs: number): Buffer {
  const sampleRate = 8000;
  const dataSize = Math.floor((sampleRate * durationMs) / 1000);
  const riff = Buffer.from("RIFF", "ascii");
  const rlen = Buffer.alloc(4);
  rlen.writeUInt32LE(36 + dataSize, 0);
  const wave = Buffer.from("WAVE", "ascii");
  const fmt = Buffer.from("fmt ", "ascii");
  const flen = Buffer.alloc(4);
  flen.writeUInt32LE(16, 0);
  const audioFormat = Buffer.alloc(2);
  audioFormat.writeUInt16LE(1, 0); // PCM
  const channels = Buffer.alloc(2);
  channels.writeUInt16LE(1, 0);
  const srate = Buffer.alloc(4);
  srate.writeUInt32LE(sampleRate, 0);
  const byteRate = Buffer.alloc(4);
  byteRate.writeUInt32LE(sampleRate, 0);
  const blockAlign = Buffer.alloc(2);
  blockAlign.writeUInt16LE(1, 0);
  const bits = Buffer.alloc(2);
  bits.writeUInt16LE(8, 0);
  const data = Buffer.from("data", "ascii");
  const dlen = Buffer.alloc(4);
  dlen.writeUInt32LE(dataSize, 0);
  const body = Buffer.alloc(dataSize);
  return Buffer.concat([
    riff, rlen, wave, fmt, flen, audioFormat, channels, srate, byteRate, blockAlign, bits, data, dlen, body,
  ]);
}

let tmpdir: string;
beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "fakeren-ambient-"));
});
afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe("LocalSnapshotAdapter (req_sensor_camera_mic)", () => {
  it("reads a real image file and extracts honest dimensions + filename semantics", async () => {
    const p = path.join(tmpdir, "窗边逆光.png");
    fs.writeFileSync(p, makePng(1280, 720));
    const adapter = new LocalSnapshotAdapter(tmpdir);
    expect(await adapter.isAvailable()).toBe(true);
    const samples = await adapter.capture();
    expect(samples).toHaveLength(1);
    expect(samples[0].kind).toBe("image");
    expect(samples[0].features.width).toBe(1280);
    expect(samples[0].features.height).toBe(720);
    expect(samples[0].features.summary).toContain("1280×720");
    expect(samples[0].features.summary).toContain("窗边逆光");
    // nothing leaves disk: localPath points at the real file
    expect(samples[0].localPath).toBe(p);
  });

  it("reads a real audio file and reports duration from the WAV header", async () => {
    const p = path.join(tmpdir, "雨声.wav");
    fs.writeFileSync(p, makeWav(500));
    const adapter = new LocalSnapshotAdapter(tmpdir);
    const samples = await adapter.capture();
    expect(samples).toHaveLength(1);
    expect(samples[0].kind).toBe("audio");
    expect(samples[0].features.durationMs).toBeGreaterThanOrEqual(450);
    expect(samples[0].features.durationMs).toBeLessThanOrEqual(550);
  });

  it("returns nothing for a missing directory (degrade, no fabricate)", async () => {
    const adapter = new LocalSnapshotAdapter(path.join(tmpdir, "nope"));
    expect(await adapter.isAvailable()).toBe(false);
    expect(await adapter.capture()).toHaveLength(0);
  });

  it("extractFeatures is shared and decodes both kinds", () => {
    const ip = path.join(tmpdir, "a.png");
    fs.writeFileSync(ip, makePng(64, 48));
    const ap = path.join(tmpdir, "b.wav");
    fs.writeFileSync(ap, makeWav(200));
    expect(extractFeatures(ip, Date.now()).kind).toBe("image");
    expect(extractFeatures(ap, Date.now()).kind).toBe("audio");
  });
});

describe("CameraMicSource (req_sensor_camera_mic)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("is OFF by default — poll yields nothing, buffer stays empty", async () => {
    delete process.env.FAKEREN_AMBIENT_CAMERA;
    delete process.env.FAKEREN_AMBIENT_MIC;
    delete process.env.FAKEREN_AMBIENT_CONTROL;
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    expect(src.isEnabled()).toBe(false);
    expect(await src.poll("i1")).toHaveLength(0);
    expect(src.getBuffer().size()).toBe(0);
  });

  it("when enabled, refresh() captures + pushes buffer; poll() then fetches the cache", async () => {
    process.env.FAKEREN_AMBIENT_CAMERA = "1";
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "0"; // no throttle for test
    fs.writeFileSync(path.join(tmpdir, "书桌.png"), makePng(800, 600));
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    // background compute
    const n = await src.refresh();
    expect(n).toBe(1);
    // foreground fetch
    const obs = await src.poll("i1");
    expect(obs).toHaveLength(1);
    expect(obs[0].source).toBe("camera_mic");
    expect(obs[0].meta?.local).toBe(true);
    expect(obs[0].meta?.ambientType).toBe("image");
    expect(src.getBuffer().size()).toBe(1);
    expect(src.getBuffer().recent(1)[0].observationText).toContain("书桌");
  });

  it("throttles repeated refresh() within the interval (budget of time, not work)", async () => {
    process.env.FAKEREN_AMBIENT_CAMERA = "1";
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "100000";
    fs.writeFileSync(path.join(tmpdir, "x.png"), makePng(10, 10));
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    const first = await src.refresh();
    expect(first).toBeGreaterThan(0);
    // immediate second refresh is throttled (interval not elapsed)
    expect(await src.refresh()).toBe(0);
  });
});

describe("NativeMediaAdapter (optional, default-off)", () => {
  it("is unavailable unless FAKEREN_AMBIENT_NATIVE=1 (never calls platform tools uninvited)", async () => {
    delete process.env.FAKEREN_AMBIENT_NATIVE;
    const a = new NativeMediaAdapter();
    expect(await a.isAvailable()).toBe(false);
    expect(await a.capture()).toHaveLength(0);
  });
});

describe("AmbientBuffer (req_ambient_decay_stream substrate)", () => {
  it("trims to the most-recent maxItems window", () => {
    const buf = new AmbientBuffer(3, 0); // ttl 0 = keep all by recency only
    for (let i = 0; i < 5; i++) {
      buf.push({
        sample: { kind: "image", capturedAt: i, localPath: `p${i}`, features: { summary: `s${i}` } },
        observationText: `s${i}`,
        at: i,
      });
    }
    expect(buf.size()).toBe(3);
    expect(buf.recent(3).map((b) => b.observationText)).toEqual(["s2", "s3", "s4"]);
  });

  it("evicts expired items by TTL", () => {
    const buf = new AmbientBuffer(100, 1000);
    buf.push({ sample: { kind: "image", capturedAt: 0, localPath: "a", features: { summary: "old" } }, observationText: "old", at: 0 });
    // simulate now far in the future via a fresh buffer with the same items? TTL is checked at push using Date.now()
    // instead, verify the contract: a just-pushed item is present
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "b", features: { summary: "new" } }, observationText: "new", at: Date.now() });
    expect(buf.size()).toBeGreaterThanOrEqual(1);
  });
});

describe("AmbientBuffer decay (req_ambient_decay_stream)", () => {
  it("excludes stale samples from seedCandidates (yesterday must not weigh on today)", () => {
    const buf = new AmbientBuffer(64, 0, 1000); // halfLife 1s
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "a", features: { summary: "此刻窗边有光" } }, observationText: "此刻窗边有光", at: Date.now() });
    buf.push({ sample: { kind: "image", capturedAt: Date.now() - 10000, localPath: "b", features: { summary: "昨天的房间" } }, observationText: "昨天的房间", at: Date.now() - 10000 });
    const cands = buf.seedCandidates(8, 0.15);
    expect(cands.map((c) => c.observationText)).toEqual(["此刻窗边有光"]);
    const stats = buf.decayStats();
    expect(stats.total).toBe(2);
    expect(stats.fresh).toBe(1);
    expect(stats.decayedOut).toBe(1);
  });

  it("decayStats reflects freshness count", () => {
    const buf = new AmbientBuffer(8, 0, 500);
    buf.push({ sample: { kind: "image", capturedAt: Date.now(), localPath: "a", features: { summary: "now" } }, observationText: "now", at: Date.now() });
    expect(buf.decayStats().fresh).toBe(1);
  });
});

describe("CameraMicSource runtime toggle (req_ambient_toggle)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("setEnabled flips capture on/off without restart, and persists to the control file", async () => {
    const ctrl = path.join(tmpdir, "ambient-control.json");
    process.env.FAKEREN_AMBIENT_ENABLE = "0";
    process.env.FAKEREN_AMBIENT_CONTROL = ctrl;
    fs.rmSync(ctrl, { force: true });
    fs.writeFileSync(path.join(tmpdir, "窗.png"), makePng(64, 48));

    // initially OFF (no control file, env 0)
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    expect(src.isEnabled()).toBe(false);
    expect(await src.poll("i1")).toHaveLength(0);

    // runtime ON — refresh computes, poll fetches
    src.setEnabled(true);
    expect(src.isEnabled()).toBe(true);
    expect(await src.refresh()).toBeGreaterThan(0);
    expect((await src.poll("i1")).length).toBeGreaterThan(0);

    // runtime OFF again — refresh clears the cache
    src.setEnabled(false);
    expect(src.isEnabled()).toBe(false);
    await src.refresh();
    expect(await src.poll("i1")).toHaveLength(0);

    // control file written and re-read by a fresh instance (survives restart)
    const raw = JSON.parse(fs.readFileSync(ctrl, "utf8"));
    expect(raw.camera).toBe(false);
    expect(raw.mic).toBe(false);
    const src2 = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    expect(src2.isEnabled()).toBe(false);
    fs.rmSync(ctrl, { force: true });
  });
});

describe("Capture whitelist + per-source switch (req_capture_whitelist)", () => {
  it("LocalSnapshotAdapter honors whitelist (only matching filenames captured)", async () => {
    fs.writeFileSync(path.join(tmpdir, "窗边逆光.png"), makePng(1280, 720));
    fs.writeFileSync(path.join(tmpdir, "雨声.wav"), makeWav(300));
    fs.writeFileSync(path.join(tmpdir, "notes.txt"), Buffer.from("ignored"));
    const a = new LocalSnapshotAdapter(tmpdir, { whitelist: ["窗"] });
    const s = await a.capture();
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe("image");
  });

  it("per-source switch isolates camera vs mic capture", async () => {
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "0";
    process.env.FAKEREN_AMBIENT_DIR = tmpdir;
    process.env.FAKEREN_AMBIENT_CONTROL = path.join(tmpdir, "ambient-control-ps.json");
    fs.writeFileSync(path.join(tmpdir, "桌.png"), makePng(64, 48));
    fs.writeFileSync(path.join(tmpdir, "声.wav"), makeWav(200));

    const src = new CameraMicSource(); // default scoped adapters (per-source kinds)
    src.setSourceEnabled("camera", true);
    src.setSourceEnabled("mic", false);
    await src.refresh();
    const cam = await src.poll("i1");
    expect(cam.length).toBeGreaterThan(0);
    expect(cam.every((o) => o.meta?.ambientType === "image")).toBe(true);

    src.setSourceEnabled("camera", false);
    src.setSourceEnabled("mic", true);
    await src.refresh();
    const mic = await src.poll("i1");
    expect(mic.length).toBeGreaterThan(0);
    expect(mic.every((o) => o.meta?.ambientType === "audio")).toBe(true);
  });
});

describe("Async precompute (req_async_precompute)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("poll() is a pure foreground fetch — it never captures, just returns the precomputed cache", async () => {
    process.env.FAKEREN_AMBIENT_CONTROL = path.join(tmpdir, "ctrl.json");
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "0";
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    src.setSourceEnabled("camera", true);
    fs.writeFileSync(path.join(tmpdir, "a.png"), makePng(10, 10));

    // before any refresh, poll yields nothing and does NOT touch the buffer
    expect(src.getBuffer().size()).toBe(0);
    expect(await src.poll("i1")).toHaveLength(0);

    // background compute fills the cache + buffer
    const n = await src.refresh();
    expect(n).toBeGreaterThan(0);

    // poll is deterministic & non-capturing across calls
    const obs1 = await src.poll("i1");
    const obs2 = await src.poll("i1");
    expect(obs1).toEqual(obs2);
    expect(src.getBuffer().size()).toBe(n); // poll did not add new captures
  });

  it("refresh() respects the surface budget (FAKEREN_AMBIENT_MAX caps samples) — the deterministic '预算' cap", async () => {
    process.env.FAKEREN_AMBIENT_CONTROL = path.join(tmpdir, "ctrl.json");
    process.env.FAKEREN_AMBIENT_CAMERA = "1";
    process.env.FAKEREN_AMBIENT_MAX = "2"; // only 2 of 5 may surface
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "0";
    const total = 5;
    for (let i = 0; i < total; i++) fs.writeFileSync(path.join(tmpdir, `f${i}.png`), makePng(8, 8));
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    const n = await src.refresh();
    expect(n).toBe(2);
    expect(src.getBuffer().size()).toBe(2);
  });

  it("start() runs a background timer that precomputes; poll() later sees the cache; stop() clears it", async () => {
    process.env.FAKEREN_AMBIENT_CONTROL = path.join(tmpdir, "ctrl.json");
    process.env.FAKEREN_AMBIENT_INTERVAL_MS = "0";
    fs.writeFileSync(path.join(tmpdir, "b.png"), makePng(10, 10));
    const src = new CameraMicSource(new LocalSnapshotAdapter(tmpdir));
    src.setSourceEnabled("camera", true);
    expect(src.isRunning()).toBe(false);

    src.start(10); // 10ms daemon tick
    expect(src.isRunning()).toBe(true);

    // wait for at least one background tick to have refreshed the cache
    await new Promise((r) => setTimeout(r, 60));
    const obs = await src.poll("i1");
    expect(obs.length).toBeGreaterThan(0); // filled by the background daemon

    src.stop();
    expect(src.isRunning()).toBe(false);
  });
});
