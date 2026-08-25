/**
 * CameraMicSource — the real-sensory SignalSource (req_sensor_camera_mic).
 *
 * Implements the existing SignalSource contract (D4 modality-agnostic host), so
 * it slots straight into the SignalBus → SituationalChannel.perceive(idle) path.
 * It is OFF by default (req_capture_whitelist minimal-by-default); enabling it
 * via FAKEREN_AMBIENT_ENABLE=1 starts periodic local capture. Every captured
 * sample is also pushed into the AmbientBuffer, which #46/#47 will wire into the
 * L0 drift seed pool.
 *
 * Failures NEVER fabricate (req_degrade_no_fabricate): adapter unavailable or
 * capture throws → empty observations.
 */

import type { InstanceId } from "../types.js";
import type { SignalObservation, SignalSource } from "../bus/signal-bus.js";
import { AmbientBuffer } from "./ambient-buffer.js";
import { LocalSnapshotAdapter, NativeMediaAdapter } from "./capture-adapter.js";
import type { AmbientCaptureAdapter } from "./types.js";
import { loadAmbientConfig } from "./config.js";

export class CameraMicSource implements SignalSource {
  private readonly buffer = new AmbientBuffer();
  private lastCapture = 0;
  private readonly cfg = loadAmbientConfig();
  private readonly adapter: AmbientCaptureAdapter;

  constructor(adapter?: AmbientCaptureAdapter) {
    // default: native if explicitly enabled+available, else local snapshot
    this.adapter = adapter ?? (this.cfg.nativeEnabled ? new NativeMediaAdapter() : new LocalSnapshotAdapter(this.cfg.dir));
  }

  definition() {
    return {
      id: "camera_mic",
      name: "摄像头/麦克风",
      description: "真实感官接入：周期性捕获摄像头帧与环境声特征，全本地处理不出行（可插拔采集适配器）",
    };
  }

  /** The ambient stream buffer, exposed for L0 drift seed consumption (#46/#47). */
  getBuffer(): AmbientBuffer {
    return this.buffer;
  }

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    if (!this.cfg.enabled) return []; // default OFF
    const now = Date.now();
    if (now - this.lastCapture < this.cfg.intervalMs) return []; // throttle
    this.lastCapture = now;

    let samples: Awaited<ReturnType<AmbientCaptureAdapter["capture"]>> = [];
    try {
      if (!(await this.adapter.isAvailable())) return [];
      samples = await this.adapter.capture();
    } catch {
      return []; // degrade, never fabricate
    }

    const out: SignalObservation[] = [];
    for (const s of samples.slice(0, this.cfg.maxSamplesPerPoll)) {
      const obs: SignalObservation = {
        text: s.features.summary,
        source: "camera_mic",
        at: s.capturedAt,
        meta: {
          local: true,
          ambientType: s.kind,
          capturedAt: s.capturedAt,
          path: s.localPath,
          brightness: s.features.brightness,
          energy: s.features.energy,
        },
      };
      this.buffer.push({ sample: s, observationText: s.features.summary, at: s.capturedAt });
      out.push(obs);
    }
    return out;
  }
}
