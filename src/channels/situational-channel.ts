/**
 * SituationalChannel — L1 情境感知 (goal-directed, C2-separated).
 *
 * Unlike drift (passive leak) and recall (targeted graph recall), L1 is the
 * instance *actively re-perceiving* its environment on idle (the L0.5 daily
 * "learn one new thing" idea, lifted to situational awareness). Signal sources
 * feed it through the bus (D4: modality-agnostic). Learned items are scoped per
 * instance (req_iso_learning_scoped).
 */

import type { ChannelContribution, InstanceId } from "../types.js";
import type { SignalBus } from "../bus/signal-bus.js";

interface LearnedFact {
  text: string;
  source: string;
  at: number;
}

/** Cap per-instance learned facts so long-lived sessions don't grow unbounded
 *  (the clock source polls every idle; keep only the most recent window). */
const MAX_LEARNED = 64;

export class SituationalChannel {
  private readonly learned = new Map<InstanceId, LearnedFact[]>();

  /** Idle-phase: poll the bus and ingest new signal-source observations. */
  async perceive(bus: SignalBus, instanceId: InstanceId): Promise<number> {
    const items = await bus.poll(instanceId);
    const arr = this.learned.get(instanceId) ?? [];
    for (const it of items) arr.push({ ...it, at: Date.now() });
    if (arr.length > MAX_LEARNED) arr.splice(0, arr.length - MAX_LEARNED);
    this.learned.set(instanceId, arr);
    return items.length;
  }

  async gather(userText: string, instanceId: InstanceId, limit = 3): Promise<ChannelContribution[]> {
    const arr = this.learned.get(instanceId) ?? [];
    const lower = userText.toLowerCase();
    const hits = arr.filter((f) => f.text.toLowerCase().includes(lower.slice(0, 12)));
    return hits.slice(-limit).map((f, i) => ({
      channel: "situational" as const,
      content: `[情境] ${f.text}`,
      seedId: `situational_${i}_${f.at}`,
    }));
  }
}
