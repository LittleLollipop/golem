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

export type DriftState = "staged" | "gathering" | "injecting" | "cooling";

export class DriftChannel {
  private state: DriftState = "staged";

  constructor(
    private readonly reader: MemoryReader,
    private readonly persistence: DshAdapter,
    private readonly registry: InstanceRegistry,
    private readonly ambient?: AmbientBuffer,
  ) {}

  getState(): DriftState {
    return this.state;
  }

  async gather(instanceId: InstanceId, limit = 3): Promise<ChannelContribution[]> {
    this.state = "gathering";
    const out: ChannelContribution[] = [];

    // (1) Cross-domain weak edges — the L0 drift seed pool.
    const seeds = await this.reader.crossDomain(instanceId, 200);
    for (const e of seeds.slice(0, limit)) {
      if (e.props?.decayed) continue; // Plan B: stop re-injecting, keep record
      const valence = Number(e.props?.valence ?? 0);
      out.push({
        channel: "drift",
        content: `[跨域联想] ${e.from} ↔ ${e.to}`,
        seedId: `drift_xd_${e.from}_${e.to}`,
        valence,
      });
    }

    // (2) RealHistoryCursor — this instance's FULL cross-session history.
    const sessionIds = await this.registry.sessionsOf(this.persistence, instanceId);
    for (const sid of sessionIds.slice(-limit)) {
      const evs = await this.persistence.loadSessionEvents(sid);
      const sig = evs.find((e) => e.type === "user" && typeof e.payload?.text === "string");
      if (sig) {
        out.push({
          channel: "drift",
          content: `[往昔] 你曾经历过：${String(sig.payload.text).slice(0, 60)}`,
          seedId: `drift_hist_${sid}_${sig.timestamp}`,
        });
      }
    }

    // (3) Ambient stream — DECAYED (req_ambient_decay_stream): only fresh
    //     samples survive into the seed pool. Stale ambience (yesterday's room,
    //     an old snapshot) never weighs on the present; seedCandidates already
    //     excludes decayed weights, so the present keeps its own texture.
    if (this.ambient) {
      for (const a of this.ambient.seedCandidates(2)) {
        out.push({
          channel: "drift",
          content: `[环境] ${a.observationText}`,
          seedId: `ambient_${a.sample.capturedAt}`,
        });
      }
    }

    this.state = "injecting";
    this.state = "cooling";
    return out;
  }
}
