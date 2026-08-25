/**
 * 假人 (FakeRen) — dsh plugin entry (Cordis).
 *
 * This is the composition root. It instantiates every layer (L1 adapter →
 * L1.5 registry → L2 memory → L3 channels → L4 bus → L5 agent) and wires the
 * two dsh seams fakeren consumes: `agent/pre-step` (turn-time leakage assembly)
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
import { Grader } from "./agent/grader.js";
import { LlmGrader } from "./agent/llm-grader.js";
import type { GradeEstimator } from "./agent/grader.js";
import { FakerenAgent } from "./agent/fakeren-agent.js";
import type { LlmClient } from "./llm/client.js";
import { HttpLlmClient } from "./llm/client.js";
import type { DshContext, UserMessage } from "./types.js";
import * as fs from "node:fs";

const PRESTEP_LOG = process.env.FAKEREN_PRESTEP_LOG ?? "/tmp/fakeren-prestep.log";

export const name = "fakeren";
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

export interface FakerenConfig {
  sidecarUrl?: string;
  /**
   * Optional LLM client. When provided (or when DEEPSEEK_API_KEY /
   * FAKEREN_LLM_API_KEY is set), the real extractor / valence / grader (#22/
   * #23/#25) replace the heuristics. Without it, the system runs on heuristics.
   */
  llm?: LlmClient;
}

export function apply(ctx: DshContext, config: FakerenConfig = {}): void {
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
  const grader: GradeEstimator = llm ? new LlmGrader(llm) : new Grader();

  const drift = new DriftChannel(reader, dsh, registry);
  const recall = new RecallChannel(new GraphRecallSource(reader));
  const situational = new SituationalChannel();
  const agent = new FakerenAgent(grader, drift, recall, situational, writer, consolidator, bus, dsh);

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
        // Default to the most-recently-created instance (req_iso_session_select).
        instanceId = list[list.length - 1].id;
      }
      await registry.select(ev.sessionId, instanceId);
    }

    await registry.touch(ev.sessionId);

    // #27: per-instance persona, injected as the identity block.
    const meta = await registry.meta(instanceId);
    const persona = meta?.persona ?? DEFAULT_PERSONA;

    const userText = ev.claimed.map((m) => m.content).join("\n");
    const { messages } = await agent.assemble(ev.claimed, userText, instanceId, persona);
    return messages;
  });

  // ── Idle: maintain every instance's memory & situational awareness ──
  dsh.runIdle(async () => {
    const list = await registry.list();
    for (const m of list) {
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
            fs.appendFileSync(PRESTEP_LOG, `[fakeren:idle] synced turn from session=${sid} instance=${m.id}\n`);
          } catch { /* best-effort */ }
        } catch (err) {
          console.error(`[fakeren:idle] syncLatestTurn skipped for ${sid}:`, err);
        }
      }
    }
  });
}
