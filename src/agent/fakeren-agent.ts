/**
 * FakerenAgent — assembles per-turn context from the three separated channels,
 * and runs idle maintenance (consolidation + situational re-perception + memory
 * sync from the RealHistoryCursor).
 *
 * Channel routing by task type (req_leak_by_task_class):
 *   execute (执行命令) → recall only                 (严谨，零漏)
 *   neutral (一般询问) → drift + recall              (轻漏)
 *   creative (对话/创作/构思) → drift + situational + recall (灵气，强漏)
 */

import type {
  UserMessage,
  ChannelContribution,
  InstanceId,
  TaskAssessment,
} from "../types.js";
import type { TaskClassifier } from "./grader.js";
import type { DriftChannel } from "../channels/drift-channel.js";
import type { RecallChannel } from "../channels/recall-channel.js";
import type { SituationalChannel } from "../channels/situational-channel.js";
import type { MemoryWriter } from "../memory/writer.js";
import type { Consolidator } from "../memory/consolidator.js";
import type { SignalBus } from "../bus/signal-bus.js";
import type { DshAdapter } from "../adapter/dsh-seams.js";
import type { LeakPostFilter, PostFilterAction } from "../leak/post-filter.js";

export class FakerenAgent {
  constructor(
    private readonly classifier: TaskClassifier,
    private readonly drift: DriftChannel,
    private readonly recall: RecallChannel,
    private readonly situational: SituationalChannel,
    private readonly writer: MemoryWriter,
    private readonly consolidator: Consolidator,
    private readonly bus: SignalBus,
    private readonly persistence: DshAdapter,
    private readonly postFilter: LeakPostFilter,
  ) {}

  async assemble(
    _claimed: UserMessage[],
    userText: string,
    instanceId: InstanceId,
    persona?: string,
  ): Promise<{
    messages: UserMessage[];
    assess: TaskAssessment;
    contributions: ChannelContribution[];
    postFilter: { action: PostFilterAction; reason: string; userPrompt?: string };
  }> {
    const assess = await this.classifier.assess(userText);
    const raw: ChannelContribution[] = [];

    // 漏出强度由任务类型决定（非问句强度）：执行命令零漏，创作强漏。
    if (assess.leakLevel === "weak" || assess.leakLevel === "strong") {
      raw.push(...(await this.drift.gather(instanceId)));
    }
    if (assess.leakLevel === "strong") {
      raw.push(...(await this.situational.gather(userText, instanceId)));
    }
    // Recall (targeted graph retrieval) is ALWAYS on. 执行命令也只保留 recall，
    // 绝不注入潜意识（严守 rule_mechanism_first 禁编造红线）。
    raw.push(...(await this.recall.gather(userText, instanceId)));

    // 执行时后筛 (req_leak_postfilter_dynamic): re-check against the execution-time
    // signal and decide the FINAL fate of the leakage (strip / ask / keep).
    const decision = this.postFilter.decide(raw, {
      taskClass: assess.taskClass,
      leakLevel: assess.leakLevel,
      userText,
    });
    const contributions = decision.contributions;

    const messages: UserMessage[] = [];
    // Persona declaration (instance-scoped, #27). dsh-seams injects it ONCE per
    // session as the first user-role message; here we only surface the text,
    // tagged channel="persona" so the adapter can pick it out.
    if (persona && persona.trim()) {
      messages.push({ role: "user", content: persona, meta: { channel: "persona" } });
    }
    if (contributions.length > 0) {
      // Strip the channel-label brackets ([图检索]/[跨域联想]/[情境]) so the model
      // reads these as its own inner voice rather than as injected instructions
      // to resist. Drop [往昔] lines for now — they currently echo prior test
      // prompts (syncLatestTurn side-effect) and read as noise; revisit with
      // real extraction (#22/#23).
      const block = contributions
        .filter((c) => !c.content.startsWith("[往昔]"))
        .map((c) => c.content.replace(/^\[(图检索|跨域联想|情境|环境|知识轨迹)\]\s*/, ""))
        .join("\n");
      messages.push({
        role: "user",
        content: `（你心里很清楚：）\n${block}`,
        meta: {
          channel: "assembled",
          // 暴露任务类型/漏出强度 + 后筛结论，供 dsh 执行时后筛 (req_leak_postfilter_dynamic)。
          taskClass: assess.taskClass,
          leakLevel: assess.leakLevel,
          postFilter: { action: decision.action, reason: decision.reason },
          seeds: contributions.map((c) => ({ id: c.seedId, channel: c.channel, valence: c.valence })),
        },
      });
    }
    return { messages, assess, contributions, postFilter: { action: decision.action, reason: decision.reason, userPrompt: decision.userPrompt } };
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
    // Injected (persona / subconscious leakage) events carry `injected: true`
    // (set at load time from data.source.fakeren, TODO#28 resolved). Never write
    // those into the memory graph — only the genuine user input is consolidated.
    const user = evs
      .filter((e) => e.type === "user" && !e.injected)
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
