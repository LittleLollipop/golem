/**
 * Concrete signal sources (#24). The host (SignalBus) stays modality-agnostic;
 * each source decides WHAT it senses and how. Register any number of these (or
 * your own) in the composition root. They feed L1 situational awareness through
 * the bus → SituationalChannel.perceive on idle.
 *
 * Neither source requires an LLM — they're cheap, local, and always on, which
 * is exactly what L1 (user-context understanding) needs: a live sense of "what
 * is happening right now" without a model call.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { InstanceId } from "../types.js";
import type { SignalObservation, SignalSource } from "./signal-bus.js";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function partOfDay(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 8) return "清晨";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 17) return "下午";
  if (hour < 19) return "傍晚";
  if (hour < 23) return "晚上";
  return "深夜";
}

/**
 * LocalClockSource — emits the current weekday + part-of-day as a situational
 * observation. Only emits when the "bucket" changes (same bucket within a
 * session → suppressed), so idle polling doesn't flood the learned buffer.
 */
export class LocalClockSource implements SignalSource {
  private lastBucket = "";

  definition() {
    return {
      id: "clock",
      name: "本地时钟",
      description: "提供当前星期与时段，作为 L1 情境信号（无感官、纯环境态）",
    };
  }

  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    const now = new Date();
    const bucket = `${WEEKDAYS[now.getDay()]}-${partOfDay(now.getHours())}`;
    if (bucket === this.lastBucket) return [];
    this.lastBucket = bucket;
    const text = `此刻是${WEEKDAYS[now.getDay()]}${partOfDay(now.getHours())}（${now.getHours()}点${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}分）`;
    return [{ text, source: "clock", at: now.getTime() }];
  }
}

/**
 * FileNotesSource — tail a local notes file and emit newly appended lines as
 * situational observations. Demonstrates a real, extensible signal source
 * (env FAKEREN_NOTES_PATH). Tracks byte offset; on truncation/rotation resets.
 */
export class FileNotesSource implements SignalSource {
  private lastSize = 0;

  constructor(
    private readonly path: string,
    private readonly sourceId = "notes",
  ) {}

  definition() {
    return {
      id: this.sourceId,
      name: "笔记文件",
      description: `从本地笔记文件 tail 新增内容作为情境信号（${this.path}）`,
    };
  }

  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(this.path);
    } catch {
      return [];
    }
    if (stat.size < this.lastSize) this.lastSize = 0; // rotated/truncated
    if (stat.size === this.lastSize) return [];
    const fh = await fsp.open(this.path, "r");
    try {
      const buf = Buffer.alloc(stat.size - this.lastSize);
      await fh.read(buf, 0, buf.length, this.lastSize);
      this.lastSize = stat.size;
      const text = buf.toString("utf8");
      // We always read from the previous byte offset (a line boundary in normal
      // line-wise appends), so splitting on newlines and dropping blanks is safe.
      const out: SignalObservation[] = [];
      for (const l of text.split(/\r?\n/)) {
        const t = l.trim();
        if (t) out.push({ text: t, source: this.sourceId, at: Date.now() });
      }
      return out;
    } finally {
      await fh.close();
    }
  }
}
