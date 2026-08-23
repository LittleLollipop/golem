/**
 * SignalBus — 信号源插件契约 (D4: 宿主对信号模态不可知).
 *
 * The host only exposes "can info come in + where it's stored". It NEVER exposes
 * *what sense* the info is (vision/audio/taste) — that is the extension
 * component's own concern (req_sensor_camera_mic boundary delegated). A
 * SignalSource is defined by a manifest, provides raw observations, and consumes
 * them back into the instance's memory — the host stays modality-agnostic.
 */

import type { InstanceId } from "../types.js";

export interface SignalObservation {
  text: string;
  source: string;
  at: number;
}

/** Definition manifest a plugin advertises (what it is, not how it senses). */
export interface SignalSourceDefinition {
  id: string;
  name: string;
  /** Human description; modalities are intentionally NOT enumerated here. */
  description: string;
}

export interface SignalSource {
  definition(): SignalSourceDefinition;
  /** Pull new observations since last poll (provider responsibility). */
  poll(instanceId: InstanceId): Promise<SignalObservation[]>;
}

/** No signal sources registered yet (keeps architecture runnable). */
export class SignalBus {
  private readonly sources = new Map<string, SignalSource>();

  register(source: SignalSource): void {
    this.sources.set(source.definition().id, source);
  }

  list(): SignalSourceDefinition[] {
    return [...this.sources.values()].map((s) => s.definition());
  }

  /** Host responsibility: gather observations from all sources, modality-agnostic. */
  async poll(instanceId: InstanceId): Promise<SignalObservation[]> {
    const out: SignalObservation[] = [];
    for (const s of this.sources.values()) {
      out.push(...(await s.poll(instanceId)));
    }
    return out;
  }
}
