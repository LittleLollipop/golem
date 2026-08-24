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

/** Prefixes used to identify synthetic messages we inject at pre-step, so
 *  syncLatestTurn can exclude them from the memory graph. Kept in sync with
 *  DshAdapter.PERSONA and the leak-block wrapper in assemble(). */
const PERSONA_PREFIX = "你是「林夏」";
const LEAK_PREFIX = "（你心里很清楚：）";

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
    // Recall (targeted graph retrieval) is ALWAYS on. Gating it by grade was a
    // mistake: the precise moment a user asks "what's your cat's name" is when
    // recall MUST fire. Drift/situational stay grade-gated; recall does not.
    contributions.push(...(await this.recall.gather(userText, instanceId)));

    const messages = claimed;
    if (contributions.length > 0) {
      // Strip the channel-label brackets ([图检索]/[跨域联想]/[情境]) so the model
      // reads these as its own inner voice rather than as injected instructions
      // to resist. Drop [往昔] lines for now — they currently echo prior test
      // prompts (syncLatestTurn side-effect) and read as noise; revisit with
      // real extraction (#22/#23).
      const block = contributions
        .filter((c) => !c.content.startsWith("[往昔]"))
        .map((c) => c.content.replace(/^\[(图检索|跨域联想|情境)\]\s*/, ""))
        .join("\n");
      messages.unshift({
        role: "user",
        content: `（你心里很清楚：）\n${block}`,
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
    // The pre-step injects TWO synthetic user/messages per turn — the persona
    // declaration and the "(你心里很清楚：) …" leak block. Those are NOT the
    // user's real memory; writing them into the graph would pollute it (we saw
    // leak-block text show up as a "memory node"). Filter them out so only the
    // genuine user input is consolidated. TODO(#28): tag injected messages with
    // a structural marker instead of string-prefix matching.
    const isInjected = (text: string): boolean =>
      text.startsWith(PERSONA_PREFIX) || text.startsWith(LEAK_PREFIX);
    const user = evs
      .filter((e) => e.type === "user" && !isInjected(String(e.payload?.text ?? "")))
      .pop();
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
