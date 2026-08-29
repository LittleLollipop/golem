/**
 * GolemAgent — assembles per-turn context from the three separated channels,
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
import { stampInjection } from "./provenance.js";

/**
 * 始终生效的操作准则（req_memory_first_default, 2026-08-29 用户决定）：要求模型
 * 在检索任何外部来源（文件系统 / 联网 / 其它）之前，先调用 memory_recall 查自己
 * 的记忆图。这是把"默认行为"从"直接 grep 文件/搜网"改成"先查记忆"——这样即便
 * 指针索引(A)或二跳(C)尚不完善，模型也会主动先回忆、出错概率大幅降低。
 * 作为独立的非角色内指令块注入，每回合 step-1 都生效。
 */
const MEMORY_FIRST_DIRECTIVE =
  "操作准则（始终生效）：当用户在对话里提到任何具体的作品、项目、人名、角色、地名或事物时，" +
  "你必须先调用 memory_recall 工具检索你自己的记忆图，确认记忆中是否已有相关内容，" +
  "再决定要不要搜索文件系统、联网或查其它来源。不要不经记忆检索，就把记忆里可能已有的东西" +
  "当作陌生信息去直接 grep 文件或搜网。";

export class GolemAgent {
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
    sessionId?: string,
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
      raw.push(...(await this.drift.gather(instanceId, undefined, sessionId)));
    }
    if (assess.leakLevel === "strong") {
      raw.push(...(await this.situational.gather(userText, instanceId)));
    }
    // Recall — dual-mechanism (2026-08-29): the auto-inject path now surfaces
    // ONLY a lightweight "memory index" (labels, no full summary) via pointers().
    // The model pulls full content on demand through the memory_recall tool.
    // pointers() is kept OUT of `raw` so the leak post-filter never touches it;
    // it is injected as its own block below.
    const pointerContribs = await this.recall.pointers(userText, instanceId);

    // 执行时后筛 (req_leak_postfilter_dynamic): re-check against the execution-time
    // signal and decide the FINAL fate of the leakage (strip / ask / keep).
    const decision = this.postFilter.decide(raw, {
      taskClass: assess.taskClass,
      leakLevel: assess.leakLevel,
      userText,
    });
    const contributions = decision.contributions;
    // 种子溯源 (req_seed_provenance)：在注入时刻盖章 injectedAt，使审计轨迹基于
    // 真实注入时间，而非模型事后自述（严守 rule_mechanism_first 禁编造红线）。
    stampInjection(contributions);

    const messages: UserMessage[] = [];
    // Persona declaration (instance-scoped, #27). dsh-seams injects it ONCE per
    // session as the first user-role message; here we only surface the text,
    // tagged channel="persona" so the adapter can pick it out. Frame it as the
    // character's OWN self-definition (not the user's speech) so the model
    // adopts it as identity rather than reading it as something the user said.
    if (persona && persona.trim()) {
      const framed = `（以下并非对话对方所说，而是你的角色设定——你自己的身份与自我认知。请以这个身份继续对话：）\n${persona}`;
      messages.push({ role: "user", content: framed, meta: { channel: "persona" } });
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
      // Strong framing: declare this is the character's OWN subconscious surfacing
      // — not user-pasted content — so the model weaves it into its inner voice
      // instead of treating it as a news snippet the "user" attached to the
      // question (the failure mode we saw with the Preston 2014-2015 snippet).
      const frame =
        "（以下不是对方发来的消息，而是你此刻潜意识里不受控浮现的念头与记忆碎片——你自己的内心活动。" +
        "让它们像你自身的思绪一样，自然地渗进你的回应语气里；不要点破它们从何而来，" +
        "也不要把它们当成对方贴给你的资料去评论或作答。）";
      messages.push({
        role: "user",
        content: `${frame}\n${block}`,
        meta: {
          channel: "assembled",
          // 暴露任务类型/漏出强度 + 后筛结论，供 dsh 执行时后筛 (req_leak_postfilter_dynamic)。
          taskClass: assess.taskClass,
          leakLevel: assess.leakLevel,
          postFilter: { action: decision.action, reason: decision.reason },
          seeds: contributions.map((c) => ({
            id: c.seedId,
            channel: c.channel,
            valence: c.valence,
            provenance: c.provenance,
          })),
        },
      });
    }
    // 始终生效的"先查记忆"操作准则（2026-08-29）：独立于角色人设与泄漏块，每
    // 回合 step-1 注入，把模型的默认检索行为改为"先回忆再查外部"。
    messages.push({
      role: "user",
      content: MEMORY_FIRST_DIRECTIVE,
      meta: { channel: "operating-directive" },
    });
    // Mechanism A pointer block (dual-mechanism-recall.md §3): a clean "memory
    // index" that is NOT in-character — its job is to tell the model which
    // memories exist and invite a memory_recall call, not to be woven into
    // prose. Distinct channel so dsh-seams renders it separately from the leak.
    if (pointerContribs.length > 0) {
      const indexList = pointerContribs.map((c) => c.content).join("、");
      // (B 护栏) 明确告知：索引相关即调 memory_recall，无需先翻文件/搜网。
      const frame =
        "（以下是你记忆图中与本次对话相关的索引（关键词）。当其中任何一条与用户当前话题相关时，" +
        "请直接调用 memory_recall 拉取完整内容，无需先翻文件或搜网：）";
      messages.push({
        role: "user",
        content: `${frame}\n${indexList}`,
        meta: { channel: "recall-pointer" },
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
