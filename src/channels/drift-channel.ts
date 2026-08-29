/**
 * DriftChannel — L0/L0.5 ambient leakage state machine (C2-separated).
 *
 * States: staged → gathering → injecting → cooling (loops each turn window).
 *
 * C2 hard rule (base-analysis §7 C2 / architecture §3): drift gathers ONLY from
 *   1. cross-domain weak edges (the physical L0 seed pool), and
 *   2. the RealHistoryCursor = dsh sessionPersistence (raw events, NOT sessionQuery).
 * It MUST NOT call ctx.sessionQuery. Code-level separation is further enforced by
 * an invariant in index.ts (drift never imports the recall path).
 *
 * Plan B decay (dec_decay_planb): decayed seeds are skipped from injection but
 * the permanent record stays. Emotion coupling (req_l0_emotion_coupling): valence
 * weights the leak and is surfaced on the contribution.
 */

import type { MemoryReader } from "../memory/reader.js";
import type { DshAdapter } from "../adapter/dsh-seams.js";
import type { InstanceRegistry } from "../registry/instance-registry.js";
import type { ChannelContribution, InstanceId } from "../types.js";
import type { AmbientBuffer } from "../ambient/ambient-buffer.js";
import type { L05Trajectory } from "../knowledge/l05-trajectory.js";
import type { LeakConfig } from "../leak/config.js";
import type { BackgroundTaskLog } from "../scheduler/background-log.js";
import { loadLeakConfig } from "../leak/config.js";
import { summarizeReply } from "../memory/summarize.js";

export type DriftState = "staged" | "gathering" | "injecting" | "cooling";

export class DriftChannel {
  private state: DriftState = "staged";

  constructor(
    private readonly reader: MemoryReader,
    private readonly persistence: DshAdapter,
    private readonly registry: InstanceRegistry,
    private readonly ambient?: AmbientBuffer,
    private readonly l05?: L05Trajectory,
    private readonly leak: LeakConfig = loadLeakConfig(),
    private readonly log?: BackgroundTaskLog,
  ) {}

  getState(): DriftState {
    return this.state;
  }

  async gather(instanceId: InstanceId, limit = 3, sessionId?: string): Promise<ChannelContribution[]> {
    this.state = "gathering";
    const out: ChannelContribution[] = [];
    // 按源分段计数，供后台调度日志记录"漂了什么"（req_background_task_log）
    const counts = { xd: 0, hist: 0, ambient: 0, l05: 0 };

    // 触发概率 (req_leak_rate_tunable): 以概率 triggerProbability 决定是否注入任何渗漏。
    if (this.leak.triggerProbability < 1 && Math.random() > this.leak.triggerProbability) {
      this.state = "cooling";
      return out;
    }

    // (1) Cross-domain weak edges — the L0 drift seed pool.
    const seeds = await this.reader.crossDomain(instanceId, 200);
    seeds.slice(0, this.leak.driftLimit).forEach((e, rank) => {
      if (e.props?.decayed) return; // Plan B: stop re-injecting, keep record
      const valence = Number(e.props?.valence ?? 0);
      if (this.leak.minValence > 0 && valence < this.leak.minValence) return; // 权重门槛
      out.push({
        channel: "drift",
        content: `[跨域联想] ${e.from} ↔ ${e.to}`,
        seedId: `drift_xd_${e.from}_${e.to}`,
        valence,
        provenance: {
          source: `edge:${e.from}->${e.to}`,
          selectionPath: `crossDomain by |valence| rank ${rank + 1} (valence ${valence})`,
        },
      });
      counts.xd++;
    });

    // (2) RealHistoryCursor — this instance's FULL cross-session history.
    const sessionIds = await this.registry.sessionsOf(this.persistence, instanceId);
    const recent = sessionIds.slice(-limit);
    for (let idx = 0; idx < recent.length; idx++) {
      const sid = recent[idx];
      const evs = await this.persistence.loadSessionEvents(sid);
      const sigIdx = evs.findIndex(
        (e) => e.type === "user" && typeof e.payload?.text === "string",
      );
      if (sigIdx < 0) continue;
      const sig = evs[sigIdx];
      // 往昔回放同时带出当轮助手的回复（记忆的回应，而非只剩提问）：配对同会话、紧随
      // 其后的 assistant 事件，跑确定性摘要（与 recall 通道同一 summarizer、同一 ↳ 标记）。
      const reply = evs.slice(sigIdx + 1).find((e) => e.type === "assistant");
      let content = `[往昔] 你曾经历过：${String(sig.payload.text).slice(0, 60)}`;
      const replyText = reply && typeof reply.payload?.text === "string" ? String(reply.payload.text) : "";
      if (replyText.trim()) {
        const summary = summarizeReply(replyText, String(sig.payload.text));
        if (summary) content += `\n  ↳ ${summary}`;
      }
      out.push({
        channel: "drift",
        content,
        seedId: `drift_hist_${sid}_${sig.timestamp}`,
        provenance: {
          source: `session:${sid}`,
          selectionPath: `recent session #${idx + 1} (event ${sig.timestamp})${replyText.trim() ? " + reply surfaced" : ""}`,
        },
      });
      counts.hist++;
    }

    // (3) Ambient stream — DECAYED (req_ambient_decay_stream): only fresh
    //     samples survive into the seed pool. Stale ambience (yesterday's room,
    //     an old snapshot) never weighs on the present; seedCandidates already
    //     excludes decayed weights, so the present keeps its own texture.
    if (this.ambient) {
      for (const a of this.ambient.seedCandidatesDetailed(this.leak.ambientLimit)) {
        out.push({
          channel: "drift",
          content: `[环境] ${a.item.observationText}`,
          seedId: `ambient_${a.item.sample.capturedAt}`,
          provenance: {
            source: `sample:${a.item.sample.capturedAt}`,
            selectionPath: `ambient ${a.item.sample.kind} fresh weight ${a.weight.toFixed(2)} (captured ${new Date(a.item.sample.capturedAt).toISOString()})`,
          },
        });
        counts.ambient++;
      }
    }

    // (4) L0.5 每日知识轨迹 (req_l05_knowledge_trajectory): the recent daily
    //     learned facts, each carrying its source citation + selection path.
    //     sessionId drives per-session dedup of learned facts (user 2026-08-29).
    if (this.l05) {
      for (const s of this.l05.seedCandidates(instanceId, this.leak.l05Limit, sessionId)) {
        const prov = s.provenance;
        out.push({
          channel: "drift",
          content: `[知识轨迹] ${s.observationText}`,
          seedId: s.seedId,
          meta: s.meta,
          provenance: prov,
        });
        counts.l05++;
      }
    }

    // 总条数上限 (req_leak_rate_tunable)：超过则截断（0 = 不封顶）。
    const capped = this.leak.maxSeeds > 0 ? out.slice(0, this.leak.maxSeeds) : out;

    // 后台调度日志：记录"漂了什么"（req_background_task_log）。仅在真正执行了
    // 漂移收集后落日志（被触发概率抑制的早返回不记，避免噪声）。
    if (this.log) {
      this.log.drift(instanceId, capped.length, { ...counts });
    }

    this.state = "injecting";
    this.state = "cooling";
    return capped;
  }
}
