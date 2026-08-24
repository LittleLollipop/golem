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
import { InstanceRegistry } from "./registry/instance-registry.js";
import { DriftChannel } from "./channels/drift-channel.js";
import { RecallChannel, GraphRecallSource } from "./channels/recall-channel.js";
import { SituationalChannel } from "./channels/situational-channel.js";
import { SignalBus } from "./bus/signal-bus.js";
import { Grader } from "./agent/grader.js";
import { FakerenAgent } from "./agent/fakeren-agent.js";
import type { DshContext, UserMessage } from "./types.js";
import * as fs from "node:fs";

const PRESTEP_LOG = process.env.FAKEREN_PRESTEP_LOG ?? "/tmp/fakeren-prestep.log";

export const name = "fakeren";
export const inject = [
  "sessionPersistence",
  "userQuestions",
];

export interface FakerenConfig {
  sidecarUrl?: string;
}

export function apply(ctx: DshContext, config: FakerenConfig = {}): void {
  const dsh = new DshAdapter(ctx);
  const store = new AxolotlClient(config.sidecarUrl);
  const registry = new InstanceRegistry(store);
  const reader = new MemoryReader(store);
  const writer = new MemoryWriter(store);
  const consolidator = new Consolidator(store);
  const bus = new SignalBus();

  const drift = new DriftChannel(reader, dsh, registry);
  const recall = new RecallChannel(new GraphRecallSource(reader));
  const situational = new SituationalChannel();
  const grader = new Grader();
  const agent = new FakerenAgent(grader, drift, recall, situational, writer, consolidator, bus, dsh);

  // Instance binding immutability is enforced at InstanceRegistry.select()
  // (throws on mid-session conflict); no separate runtime re-check needed.

  // ── Turn-time: assemble leakage into the model-visible context ──
  dsh.onPreStep(async (ev): Promise<UserMessage[]> => {
    let instanceId = await registry.current(ev.sessionId);
    if (!instanceId) {
      const list = await registry.list();
      if (list.length === 0) {
        instanceId = (await registry.create("default", "默认假人")).id;
      } else {
        // Default to the most-recently-created instance (req_iso_session_select).
        instanceId = list[list.length - 1].id;
      }
      await registry.select(ev.sessionId, instanceId);
    }

    await registry.touch(ev.sessionId);

    const userText = ev.claimed.map((m) => m.content).join("\n");
    const { messages } = await agent.assemble(ev.claimed, userText, instanceId);
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
