/**
 * FakerenAgent — assembles per-turn context from the three separated channels,
 * and runs idle maintenance (consolidation + situational re-perception + memory
 * sync from the RealHistoryCursor).
 *
 * Channel routing by grade (architecture §4):
 *   zero   → drift + recall + situational   (max leakage)
 *   weak   → drift + situational
 *   strong → recall only                     (factual, no leakage)
 */

import type {
  UserMessage,
  ChannelContribution,
  InstanceId,
  GradeResult,
} from "../types.js";
import type { Grader } from "./grader.js";
import type { DriftChannel } from "../channels/drift-channel.js";
import type { RecallChannel } from "../channels/recall-channel.js";
import type { SituationalChannel } from "../channels/situational-channel.js";
import type { MemoryWriter } from "../memory/writer.js";
import type { Consolidator } from "../memory/consolidator.js";
import type { SignalBus } from "../bus/signal-bus.js";
import type { DshAdapter } from "../adapter/dsh-seams.js";

export class FakerenAgent {
  constructor(
    private readonly grader: Grader,
    private readonly drift: DriftChannel,
    private readonly recall: RecallChannel,
    private readonly situational: SituationalChannel,
    private readonly writer: MemoryWriter,
    private readonly consolidator: Consolidator,
    private readonly bus: SignalBus,
    private readonly persistence: DshAdapter,
  ) {}

  async assemble(
    claimed: UserMessage[],
    userText: string,
    instanceId: InstanceId,
  ): Promise<{ messages: UserMessage[]; grade: GradeResult; contributions: ChannelContribution[] }> {
    const grade = this.grader.grade(userText);
    const contributions: ChannelContribution[] = [];

    if (grade.grade === "zero" || grade.grade === "weak") {
      contributions.push(...(await this.drift.gather(instanceId)));
    }
    if (grade.grade === "zero") {
      contributions.push(...(await this.situational.gather(userText, instanceId)));
    }
    if (grade.grade === "strong" || grade.grade === "zero") {
      // recall is allowed for both strong (factual) and zero (full context)
      contributions.push(...(await this.recall.gather(userText, instanceId)));
    }

    const messages = claimed;
    if (contributions.length > 0) {
      const block = contributions.map((c) => c.content).join("\n");
      messages.unshift({
        role: "user",
        content: `（假人潜意识渗漏，仅供你感知，不必显式回应）\n${block}`,
        meta: {
          channel: "assembled",
          seeds: contributions.map((c) => ({ id: c.seedId, channel: c.channel, valence: c.valence })),
        },
      });
    }
    return { messages, grade, contributions };
  }

  /** Idle phase: maintain this instance's memory & situational awareness. */
  async idleMaintenance(instanceId: InstanceId): Promise<void> {
    await this.consolidator.run(instanceId); // Plan B decay + conservative growth
    await this.situational.perceive(this.bus, instanceId);
  }

  /** Build memory from the latest session events (RealHistoryCursor).
   *  Called at turn-start so we never need an undocumented post-step hook. */
  async syncLatestTurn(instanceId: InstanceId, sessionId: string): Promise<void> {
    const evs = await this.persistence.loadSessionEvents(sessionId);
    const user = evs.filter((e) => e.type === "user").pop();
    const assistant = evs.filter((e) => e.type === "assistant").pop();
    if (user && assistant && typeof user.payload?.text === "string" && typeof assistant.payload?.text === "string") {
      await this.writer.writeTurn({
        instanceId,
        userText: String(user.payload.text),
        assistantText: String(assistant.payload.text),
        timestamp: user.timestamp,
      });
    }
  }
}
