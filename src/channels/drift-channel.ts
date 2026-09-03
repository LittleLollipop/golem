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
import type { ChannelContribution, GraphEdge, InstanceId } from "../types.js";
import type { AmbientBuffer } from "../ambient/ambient-buffer.js";
import type { L05Trajectory } from "../knowledge/l05-trajectory.js";
import type { LeakConfig } from "../leak/config.js";
import type { BackgroundTaskLog } from "../scheduler/background-log.js";
import { loadLeakConfig } from "../leak/config.js";
import { summarizeReply } from "../memory/summarize.js";
import { CROSS_DOMAIN_COOLDOWN, LeakCooldown } from "../leak/cooldown.js";

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
    /**
     * Shared cooldown table. Both leak sub-channels (crossDomain + L0.5) cool
     * down through this single instance — the asymmetry between them (one had
     * no dedup, the other excluded forever) is exactly the bug this guards
     * against (docs/leak-seed-pool.md §4.1).
     */
    readonly cooldown: LeakCooldown = new LeakCooldown(),
    /** Injectable RNG so weighted rotation is testable. */
    private readonly rng: () => number = Math.random,
  ) {
    // Hand the SAME table to L0.5 so it cannot re-implement its own dedup.
    l05?.attachCooldown(cooldown);
  }

  getState(): DriftState {
    return this.state;
  }

  async gather(
    instanceId: InstanceId,
    limit = 3,
    sessionId?: string,
    /** Injectable clock (epoch ms). Cooldown windows are time-based, so a
     *  deterministic clock is what makes multi-turn simulations reproducible. */
    now: number = Date.now(),
  ): Promise<ChannelContribution[]> {
    this.state = "gathering";
    const out: ChannelContribution[] = [];
    // 按源分段计数，供后台调度日志记录"漂了什么"（req_background_task_log）
    const counts = { xd: 0, hist: 0, histSkipped: 0, ambient: 0, l05: 0 };

    // 触发概率 (req_leak_rate_tunable): 以概率 triggerProbability 决定是否注入任何渗漏。
    if (this.leak.triggerProbability < 1 && Math.random() > this.leak.triggerProbability) {
      this.state = "cooling";
      return out;
    }

    // 轮次推进（冷却的"轮"维度）。被触发概率抑制的早返回不推进 —— 没漏就不算一轮。
    // scope = 会话：新会话冷却表为空，与 L0.5 同一 scope，两条通道因此同频。
    const scope = sessionId ?? `inst:${instanceId}`;
    this.cooldown.beginTurn(scope);

    // (1) Cross-domain weak edges — the L0 drift seed pool.
    //
    // Two defects fixed here (docs/leak-seed-pool.md §2):
    //   a) NO dedup at all — the pool was re-gathered every turn and sidecar
    //      returns it in insertion order, so `slice(0, 3)` handed the same 3
    //      oldest edges a permanent seat (普雷斯顿/科索沃各漏 20/40 轮).
    //   b) insertion order = chronological, so new edges never got a turn.
    // Fix: cooldown gate + weighted rotation (starvation-weighted sampling).
    const seeds = await this.reader.crossDomain(instanceId, 200);
    const pool = seeds.filter((e) => {
      if (e.props?.decayed) return false; // Plan B: stop re-injecting, keep record
      return this.cooldown.available(scope, xdKey(e), CROSS_DOMAIN_COOLDOWN, now);
    });
    for (const { edge, weight, idle } of this.rotate(pool, this.leak.driftLimit, scope)) {
      const valence = Number(edge.props?.valence ?? 0);
      this.cooldown.take(scope, xdKey(edge), now);
      out.push({
        channel: "drift",
        content: `[跨域联想] ${edge.from} ↔ ${edge.to}`,
        seedId: `drift_xd_${edge.from}_${edge.to}`,
        valence,
        provenance: {
          source: `edge:${edge.from}->${edge.to}`,
          selectionPath: `crossDomain weighted-rotate (w=${weight.toFixed(2)}, idle=${idle})`,
        },
      });
      counts.xd++;
    }

    // (2) RealHistoryCursor — this instance's FULL cross-session history.
    //
    // The CURRENT session is live during pre-step: dsh forbids
    // sessionPersistence.load() while the turn is open, so loadSessionEvents
    // swallows the throw and returns []. Calling it every single turn for a
    // session that can never load is pure noise (docs/leak-seed-pool.md §4.4)
    // — and it silently reports "no history" instead of "history not readable
    // yet". Skip the live session explicitly and count it as histSkipped so the
    // background log shows WHY hist is 0.
    const sessionIds = await this.registry.sessionsOf(this.persistence, instanceId);
    const closed = sessionIds.filter((sid) => sid !== sessionId);
    counts.histSkipped = sessionIds.length - closed.length;
    const recent = closed.slice(-limit);
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
    //     sessionId scopes the shared cooldown: a fact resurfaces after the
    //     window instead of being excluded for the rest of the session.
    if (this.l05) {
      const seeds = this.l05.seedCandidates(instanceId, this.leak.l05Limit, sessionId, now);
      for (const s of seeds) {
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
    // hist=0 必须能被解释：histSkipped 说明有多少会话是因为 live（本轮尚未关闭）
    // 被主动跳过的，而不是"这个人没有过去"。
    if (this.log) {
      this.log.drift(instanceId, capped.length, { ...counts });
    }

    this.state = "injecting";
    this.state = "cooling";
    return capped;
  }

  /**
   * Starvation-weighted rotation over the cross-domain pool.
   *
   * sidecar returns edges in insertion order (= chronological) and stores no
   * timestamp on the edge, so "recency" cannot be computed from the graph. What
   * we CAN compute — and what actually matters — is how long a seed has been
   * *silent*: `idle` turns since it last leaked. Never-leaked edges are treated
   * as maximally starved, which is what lets newly learned knowledge (arriving
   * as new edges) surface instead of losing to the oldest edges forever.
   *
   *   w = edge.weight × (1 + idle/cap) × rng()
   *
   * Sampled without replacement, so one gather cannot repeat an edge.
   */
  private rotate(
    pool: GraphEdge[],
    count: number,
    scope: string,
  ): Array<{ edge: GraphEdge; weight: number; idle: string }> {
    const cap = CROSS_DOMAIN_COOLDOWN.turns ?? 10;
    const scored = pool.map((edge) => {
      const key = xdKey(edge);
      const fresh = !this.cooldown.hasLeaked(scope, key);
      const idleTurns = this.cooldown.turnsSince(scope, key, cap);
      const weight = Math.max((edge.weight ?? 1) * (1 + idleTurns / cap) * this.rng(), 1e-6);
      return { edge, weight, idle: fresh ? "new" : `${idleTurns}t` };
    });
    const picked: Array<{ edge: GraphEdge; weight: number; idle: string }> = [];
    const remaining = [...scored];
    while (picked.length < count && remaining.length > 0) {
      const total = remaining.reduce((s, x) => s + x.weight, 0);
      let r = this.rng() * total;
      let idx = remaining.length - 1;
      for (let i = 0; i < remaining.length; i++) {
        r -= remaining[i].weight;
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      picked.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
    return picked;
  }
}

/** Stable cooldown key for a cross-domain edge (from/to/kind identify an edge). */
function xdKey(e: GraphEdge): string {
  return `xd:${e.kind}:${e.from}->${e.to}`;
}
