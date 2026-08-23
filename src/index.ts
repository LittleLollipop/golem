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

export const name = "fakeren";
export const inject = [
  "agent",
  "sessionPersistence",
  "invariants",
  "userQuestions",
  "storageDomain",
];

export interface FakerenConfig {
  sidecarUrl?: string;
}

export function apply(ctx: DshContext, config: FakerenConfig = {}): void {
  const dsh = new DshAdapter(ctx);
  const store = new AxolotlClient(config.sidecarUrl);
  const registry = new InstanceRegistry(store, dsh.storage());
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

    // Build this instance's memory from the latest persisted turn first.
    await agent.syncLatestTurn(instanceId, ev.sessionId);
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
    }
  });
}

export default { name, inject, apply };
