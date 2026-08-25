/**
 * Concrete ambient capture adapters (req_sensor_camera_mic).
 *
 * Both adapters are 100% LOCAL. LocalSnapshotAdapter reads real snapshot files
 * the user/system has placed in a drop directory (e.g. a real screenshot, a
 * real voice memo) and extracts *honest* features from the file's own metadata
 * (true dimensions, true capture time, filename semantics) — no pixel decoding,
 * no cloud, no model. NativeMediaAdapter optionally performs genuine capture via
 * platform tools, but ONLY when explicitly enabled and the binary exists; it
 * then reuses the same local feature extraction.
 *
 * Pixel-level scene understanding would need an image lib (sharp/pngjs) or a
 * model call — intentionally deferred (would break "local-only, no fabricate").
 * The features we emit are real and reproducible; they are coarse by design.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { AmbientCaptureAdapter, AmbientSample, AmbientKind } from "./types.js";

export interface SnapshotOpts {
  /** restrict to image / audio only */
  kinds?: AmbientKind[];
  /** capture-scope whitelist: file-name substrings that MUST match (req_capture_whitelist) */
  whitelist?: string[];
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const AUDIO_EXT = new Set(["wav", "mp3", "m4a", "aac", "ogg", "flac"]);

function extOf(p: string): string {
  return path.extname(p).replace(/^\./, "").toLowerCase();
}
function partOfDay(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "凌晨";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 13) return "中午";
  if (h < 17) return "下午";
  if (h < 19) return "傍晚";
  if (h < 23) return "晚上";
  return "深夜";
}

/** Honest image dimensions parsed straight from PNG/JPEG headers (no decode). */
function imageDimensions(buf: Buffer, ext: string): { w: number; h: number } | undefined {
  if (ext === "png" && buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    // PNG IHDR: width @ offset 16, height @ offset 20 (big-endian)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if ((ext === "jpg" || ext === "jpeg") && buf.length > 10) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] === 0xff && buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xcf) {
        if (buf[i + 1] === 0xc4 || buf[i + 1] === 0xc8 || buf[i + 1] === 0xcc) {
          i += 2;
          continue;
        }
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        if (w > 0 && h > 0) return { w, h };
      }
      i += 2;
    }
  }
  return undefined;
}

/** Honest WAV duration parsed from the RIFF header (mp3/m4a left undefined). */
function audioDurationMs(buf: Buffer, ext: string): number | undefined {
  if (ext === "wav" && buf.length > 44 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) {
    const dataSize = buf.readUInt32LE(40);
    const sampleRate = buf.readUInt32LE(24) || 1;
    const channels = buf.readUInt16LE(22) || 1;
    const bits = buf.readUInt16LE(34) || 8;
    const byteRate = (sampleRate * channels * bits) / 8;
    if (byteRate > 0) return Math.round((dataSize / byteRate) * 1000);
  }
  return undefined;
}

/** Coarse brightness from a byte sample (real but approximate — not a decode). */
function coarseBrightness(buf: Buffer): number {
  const step = Math.max(1, Math.floor(buf.length / 256));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < buf.length; i += step) {
    sum += buf[i];
    n++;
  }
  return n > 0 ? Math.min(1, sum / n / 255) : 0.5;
}

function fileNameSemantics(p: string): string {
  const base = path.basename(p, path.extname(p));
  return base.replace(/[_\-]+/g, " ").trim() || "未命名快照";
}

/** Shared feature extraction — used by BOTH adapters (local + native). */
export function extractFeatures(localPath: string, capturedAt: number): AmbientSample {
  const ext = extOf(localPath);
  const buf = fs.readFileSync(localPath);
  const when = new Date(capturedAt);
  const isImg = IMAGE_EXT.has(ext);
  if (isImg) {
    const dim = imageDimensions(buf, ext);
    const brightness = coarseBrightness(buf);
    const dominantHue = brightness > 0.6 ? "warm" : brightness < 0.35 ? "cool" : "neutral";
    const size = dim ? `${dim.w}×${dim.h}` : "未知尺寸";
    const summary = `环境快照：${fileNameSemantics(localPath)}（${size}，${partOfDay(when)}）`;
    return {
      kind: "image",
      capturedAt,
      localPath,
      features: { summary, brightness, dominantHue, width: dim?.w, height: dim?.h },
    };
  }
  const dur = audioDurationMs(buf, ext);
  const energy = coarseBrightness(buf);
  const summary = `环境声：${fileNameSemantics(localPath)}${dur ? `（约${Math.round(dur / 1000)}秒` : ""}，${partOfDay(when)}）`;
  return {
    kind: "audio",
    capturedAt,
    localPath,
    features: { summary, energy, durationMs: dur },
  };
}

/**
 * LocalSnapshotAdapter — reads the most recently modified real snapshot files
 * from a local drop directory. This is the DEFAULT adapter: it requires no
 * privilege, no cloud, and works today (dropping a real screenshot / voice memo
 * in the dir IS real sensory input). Honors per-source kinds + a capture-scope
 * whitelist (req_capture_whitelist).
 */
export class LocalSnapshotAdapter implements AmbientCaptureAdapter {
  readonly id = "local-snapshot";
  readonly description = "从本地快照目录读取真实图片/音频文件，本地提取特征（默认适配器）";

  constructor(
    private readonly dir: string,
    private readonly opts: SnapshotOpts = {},
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      return (await fsp.stat(this.dir)).isDirectory();
    } catch {
      return false;
    }
  }

  async capture(): Promise<AmbientSample[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(this.dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = entries
      .filter((e) => e.isFile())
      .filter((e) => {
        const okImg = IMAGE_EXT.has(extOf(e.name));
        const okAud = AUDIO_EXT.has(extOf(e.name));
        if (!okImg && !okAud) return false;
        if (this.opts.kinds && this.opts.kinds.length) {
          if (okImg && !this.opts.kinds.includes("image")) return false;
          if (okAud && !this.opts.kinds.includes("audio")) return false;
        }
        if (this.opts.whitelist && this.opts.whitelist.length) {
          const lower = e.name.toLowerCase();
          if (!this.opts.whitelist.some((w) => lower.includes(w.toLowerCase()))) return false;
        }
        return true;
      })
      .map((e) => path.join(this.dir, e.name));
    // newest first (real mtime = real capture recency)
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const out: AmbientSample[] = [];
    for (const f of files.slice(0, 4)) {
      try {
        out.push(extractFeatures(f, fs.statSync(f).mtimeMs));
      } catch {
        /* skip unreadable file; never fabricate */
      }
    }
    return out;
  }
}

function which(bin: string): boolean {
  try {
    const r = spawnSync("which", [bin], { timeout: 2000, killSignal: "SIGKILL" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * NativeMediaAdapter — genuine capture via platform tools. OFF by default and
 * only active when FAKEREN_AMBIENT_NATIVE=1 AND the required binaries exist
 * (mac: `imagesnap` for camera, `ffmpeg` for mic). It writes to a temp file
 * then reuses the same local feature extraction. Never called unless available.
 */
export class NativeMediaAdapter implements AmbientCaptureAdapter {
  readonly id = "native-media";
  readonly description = "调用平台工具(imagesnap/ffmpeg)真实捕获摄像头/麦克风，本地处理（需显式启用）";

  async isAvailable(): Promise<boolean> {
    if (process.env.FAKEREN_AMBIENT_NATIVE !== "1") return false;
    return which("imagesnap") || which("ffmpeg");
  }

  async capture(): Promise<AmbientSample[]> {
    // Defensive guard: never touch platform tools unless explicitly opted in.
    if (process.env.FAKEREN_AMBIENT_NATIVE !== "1") return [];
    const out: AmbientSample[] = [];
    const stamp = Date.now();

    // camera: imagesnap -w 1 <tmp>.jpg
    if (which("imagesnap")) {
      const jpg = path.join(os.tmpdir(), `fakeren-cam-${stamp}.jpg`);
      const r = spawnSync("imagesnap", ["-w", "1", jpg], { timeout: 8000 });
      if (r.status === 0 && fs.existsSync(jpg)) {
        out.push(extractFeatures(jpg, stamp));
      }
    }
    // mic: ffmpeg -f avfoundation -i ":0" -t 1 <tmp>.wav
    if (which("ffmpeg")) {
      const wav = path.join(os.tmpdir(), `fakeren-mic-${stamp}.wav`);
      const r = spawnSync("ffmpeg", ["-y", "-f", "avfoundation", "-i", ":0", "-t", "1", wav], {
        timeout: 8000,
        stdio: "ignore",
      });
      if (r.status === 0 && fs.existsSync(wav)) {
        out.push(extractFeatures(wav, stamp));
      }
    }
    return out;
  }
}
