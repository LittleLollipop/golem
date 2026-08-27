/**
 * 假人 (Golem) — dsh plugin entry (Cordis).
 *
 * This is the composition root. It instantiates every layer (L1 adapter →
 * L1.5 registry → L2 memory → L3 channels → L4 bus → L5 agent) and wires the
 * two dsh seams golem consumes: `agent/pre-step` (turn-time leakage assembly)
 * and `agent.runMaintenance` (idle maintenance). Nothing here forks or patches
 * dsh core (C3).
 */

import { DshAdapter } from "./adapter/dsh-seams.js";
import { AxolotlClient } from "./memory/axolotl-client.js";
import { MemoryWriter } from "./memory/writer.js";
import { MemoryReader } from "./memory/reader.js";
import { Consolidator } from "./memory/consolidator.js";
import { LlmExtractor } from "./memory/llm-extractor.js";
import { LlmValence } from "./memory/llm-valence.js";
import { InstanceRegistry } from "./registry/instance-registry.js";
import { DriftChannel } from "./channels/drift-channel.js";
import { RecallChannel, GraphRecallSource } from "./channels/recall-channel.js";
import { SituationalChannel } from "./channels/situational-channel.js";
import { SignalBus } from "./bus/signal-bus.js";
import { LocalClockSource, FileNotesSource } from "./bus/sources.js";
import { CameraMicSource } from "./ambient/ambient-source.js";
import { StaticKnowledgeSource } from "./knowledge/static-source.js";
import { WikipediaKnowledgeSource } from "./knowledge/wikipedia-source.js";
import { NewsRssKnowledgeSource } from "./knowledge/news-rss-source.js";
import { SocialTrendingKnowledgeSource } from "./knowledge/social-trending-source.js";
import type { KnowledgeMode, KnowledgeSource } from "./knowledge/types.js";
import { DailyKnowledgeTracker } from "./knowledge/daily-tracker.js";
import { L05Trajectory } from "./knowledge/l05-trajectory.js";
import { KnowledgeSourceRegistry } from "./knowledge/registry.js";
import { LearningPlanner } from "./knowledge/planner.js";
import { WebSearchKnowledgeSource } from "./knowledge/web-search-source.js";
import { Grader } from "./agent/grader.js";
import { LlmGrader } from "./agent/llm-grader.js";
import type { TaskClassifier } from "./agent/grader.js";
import { GolemAgent } from "./agent/golem-agent.js";
import { LeakPostFilter } from "./leak/post-filter.js";
import { loadLeakConfig } from "./leak/config.js";
import { BackgroundTaskLog } from "./scheduler/background-log.js";
import type { LlmClient } from "./llm/client.js";
import { HttpLlmClient } from "./llm/client.js";
import type { DshContext, UserMessage } from "./types.js";
import * as fs from "node:fs";

const PRESTEP_LOG = process.env.FAKEREN_PRESTEP_LOG ?? "/tmp/fakeren-prestep.log";

export const name = "golem";
export const inject = [
  "sessionPersistence",
  "userQuestions",
];

/**
 * Fallback persona when an instance has none set (#27). Kept here (not in the
 * dsh adapter) so the agent — not the transport — owns identity. The original
 * validated "林夏" identity; new instances can override via the config page /
 * scripts/manage-instance.mjs.
 */
const DEFAULT_PERSONA = `你是「林夏」，一个真实存在的年轻女性，独自住在城市的一间小公寓里。你养了一只橘猫，叫豆豆；你性格内向，喜欢在雨天一个人待着听歌，面对陌生环境会本能地保持警惕。现在你在和朋友闲聊，请用第一人称自然地说话，不要声明自己是 AI 或没有身体——那些记忆与感受都是你真实的。`;

export interface GolemConfig {
  sidecarUrl?: string;
  /**
   * Optional LLM client. When provided (or when DEEPSEEK_API_KEY /
   * FAKEREN_LLM_API_KEY is set), the real extractor / valence / grader (#22/
   * #23/#25) replace the heuristics. Without it, the system runs on heuristics.
   */
  llm?: LlmClient;
}

export function apply(ctx: DshContext, config: GolemConfig = {}): void {
  const dsh = new DshAdapter(ctx);
  const store = new AxolotlClient(config.sidecarUrl);
  const registry = new InstanceRegistry(store);
  const reader = new MemoryReader(store);
  const consolidator = new Consolidator(store);
  const bus = new SignalBus();

  // ── #24: signal sources (L1 situational awareness) ──
  bus.register(new LocalClockSource());
  const notesPath = process.env.FAKEREN_NOTES_PATH;
  if (notesPath) bus.register(new FileNotesSource(notesPath));
  // ── #45: real-sensory source (camera/mic), OFF by default (opt-in via env) ──
  // 共享的后台调度日志实例（req_background_task_log），注入到三个站点。
  const schedulerLog = new BackgroundTaskLog();
  const ambientSource = new CameraMicSource(undefined, schedulerLog);
  bus.register(ambientSource);
  // ── #49: background daemon — precompute the ambient cache off the critical path ──
  ambientSource.start();

  // ── #22/#23/#25: opt-in LLM-backed seams (heuristic fallback otherwise) ──
  let llm: LlmClient | undefined = config.llm;
  if (!llm && (process.env.DEEPSEEK_API_KEY || process.env.FAKEREN_LLM_API_KEY)) {
    try {
      llm = new HttpLlmClient();
    } catch {
      llm = undefined; // no key → stay heuristic
    }
  }
  const writer = new MemoryWriter(
    store,
    llm ? new LlmExtractor(llm) : undefined,
    llm ? new LlmValence(llm) : undefined,
  );
  const classifier: TaskClassifier = llm ? new LlmGrader(llm) : new Grader();

  // ── #51: L0.5 每日知识轨迹 — 双轨 (随机机械 + 目的模型驱动) ──
  const knowledgeDir = process.env.FAKEREN_KNOWLEDGE_DIR ?? "./.fakeren-knowledge";
  // FAKEREN_KNOWLEDGE_SOURCE 现在语义 = 锁"目的轨" source（锁渠道不锁模型，dec_l05 B）
  const pinSource = process.env.FAKEREN_KNOWLEDGE_SOURCE || undefined;
  const knowledgeLang = process.env.FAKEREN_KNOWLEDGE_LANG ?? "zh";
  // 全局模式覆盖；不设时各源用自己的 defaultMode（wiki=random, news/social=top）。
  const modeOverride = process.env.FAKEREN_KNOWLEDGE_MODE as KnowledgeMode | undefined;

  // 随机轨：固定 wiki random —— 抗极化引擎，永不依赖模型/图库
  const randomSource = new WikipediaKnowledgeSource({ lang: knowledgeLang, mode: "random" });
  // 目的轨候选源（全开放：wiki/news/social/web + 机械兜底 static）
  const sources: Record<string, KnowledgeSource> = {
    wiki: new WikipediaKnowledgeSource({ lang: knowledgeLang, mode: modeOverride }),
    news: new NewsRssKnowledgeSource({ lang: knowledgeLang, mode: modeOverride }),
    social: new SocialTrendingKnowledgeSource({ mode: modeOverride }),
    web: new WebSearchKnowledgeSource(),
    static: new StaticKnowledgeSource(),
  };
  const knowledgeRegistry = new KnowledgeSourceRegistry(sources, "wiki");

  // 目的轨规划器：仅在有 LLM 时启用；否则目的轨记 empty 状态（不兜底默认内容）
  let knowledgeTracker: DailyKnowledgeTracker;
  const planner = llm
    ? new LearningPlanner(llm, store, {
        recentLearnedTitles: (id) => knowledgeTracker.recentTrajectory(id, 15).map((f) => f.title),
        pinSource,
      })
    : undefined;
  knowledgeTracker = new DailyKnowledgeTracker(randomSource, knowledgeRegistry, knowledgeDir, planner);
  const l05 = new L05Trajectory(knowledgeTracker, 7, schedulerLog);
  console.log(
    `[golem] L0.5 = dual-track (random: wikipedia/random + purposeful: ${planner ? "model-planned[wiki/news/social/web]" : "no-LLM → 记 empty 状态"})`,
  );

  const drift = new DriftChannel(reader, dsh, registry, ambientSource.getBuffer(), l05, loadLeakConfig(), schedulerLog);
  const recall = new RecallChannel(new GraphRecallSource(reader));
  const situational = new SituationalChannel();
  const agent = new GolemAgent(classifier, drift, recall, situational, writer, consolidator, bus, dsh, new LeakPostFilter());

  // Instance binding immutability is enforced at InstanceRegistry.select()
  // (throws on mid-session conflict); no separate runtime re-check needed.

  // ── Turn-time: assemble leakage into the model-visible context ──
  dsh.onPreStep(async (ev): Promise<UserMessage[]> => {
    let instanceId = await registry.current(ev.sessionId);
    if (!instanceId) {
      const list = await registry.list();
      if (list.length === 0) {
        instanceId = (await registry.create("default", "默认假人", DEFAULT_PERSONA)).id;
      } else {
        // 默认实例优先级：配置页「设为默认」> 最近创建的实例 (req_iso_session_select)。
        const ids = list.map((m) => m.id);
        const def = await store.getDefaultInstance();
        instanceId = def && ids.includes(def) ? def : ids[ids.length - 1];
      }
      await registry.select(ev.sessionId, instanceId);
    }

    await registry.touch(ev.sessionId);

    // #27: per-instance persona, injected as the identity block.
    const meta = await registry.meta(instanceId);
    const persona = meta?.persona ?? DEFAULT_PERSONA;

    const userText = ev.claimed.map((m) => m.content).join("\n");
    const res = await agent.assemble(ev.claimed, userText, instanceId, persona);
    // 执行时后筛：歧义时主动交用户双候选（req_leak_postfilter_dynamic）。
    if (res.postFilter?.userPrompt) {
      try {
        await ctx.userQuestions?.ask(res.postFilter.userPrompt);
      } catch {
        /* host may not support interactive questions */
      }
    }
    return res.messages;
  });

  // ── Idle: maintain every instance's memory & situational awareness ──
  dsh.runIdle(async () => {
    // #49: refresh the ambient precompute cache once per idle (the daemon timer
    // also covers gaps between idles). Foreground poll() then just fetches it.
    await ambientSource.refresh();
    const list = await registry.list();
    for (const m of list) {
      // #51: ensure today's L0.5 knowledge fact is captured for this instance.
      await l05.tick(m.id);
      await agent.idleMaintenance(m.id);
      // Build this instance's memory from each bound session's latest (now
      // CLOSED) turn. Must NOT run at pre-step — the session is live then and
      // dsh's sessionPersistence.load() rejects "live turn is open; use the
      // live Session". At idle the turn is closed, so loadSessionEvents works.
      const sessions = await registry.sessionsOf(dsh, m.id);
      for (const sid of sessions) {
        try {
          await agent.syncLatestTurn(m.id, sid);
          try {
            fs.appendFileSync(PRESTEP_LOG, `[golem:idle] synced turn from session=${sid} instance=${m.id}\n`);
          } catch { /* best-effort */ }
        } catch (err) {
          console.error(`[golem:idle] syncLatestTurn skipped for ${sid}:`, err);
        }
      }
    }
  });
}
