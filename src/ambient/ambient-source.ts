/**
 * CameraMicSource — the real-sensory SignalSource (req_sensor_camera_mic).
 *
 * Implements the existing SignalSource contract (D4 modality-agnostic host), so
 * it slots straight into the SignalBus → SituationalChannel.perceive(idle) path.
 * It is OFF by default (req_capture_whitelist minimal-by-default); enabling it
 * via FAKEREN_AMBIENT_ENABLE=1 (or the runtime control file, req_ambient_toggle)
 * starts periodic local capture. Every captured sample is also pushed into the
 * AmbientBuffer, which #46/#47 wire into the L0 drift seed pool.
 *
 * Failures NEVER fabricate (req_degrade_no_fabricate): adapter unavailable or
 * capture throws → empty observations.
 *
 * Runtime toggle (req_ambient_toggle): setEnabled flips capture + injection on
 * or off WITHOUT a restart; the choice persists to ambient-control.json.
 */

import type { InstanceId } from "../types.js";
import type { SignalObservation, SignalSource } from "../bus/signal-bus.js";
import { AmbientBuffer } from "./ambient-buffer.js";
import { LocalSnapshotAdapter, NativeMediaAdapter } from "./capture-adapter.js";
import type { AmbientCaptureAdapter } from "./types.js";
import { loadAmbientConfig, loadAmbientControl, saveAmbientControl } from "./config.js";

export class CameraMicSource implements SignalSource {
  private readonly buffer = new AmbientBuffer();
  private lastCapture = 0;
  private readonly cfg = loadAmbientConfig();
  private readonly adapter: AmbientCaptureAdapter;
  /** runtime toggle (req_ambient_toggle): control file OR env can flip it live */
  private enabled: boolean;

  constructor(adapter?: AmbientCaptureAdapter) {
    this.adapter = adapter ?? (this.cfg.nativeEnabled ? new NativeMediaAdapter() : new LocalSnapshotAdapter(this.cfg.dir));
    // control file (if present) overrides the env default, enabling runtime toggle
    this.enabled = loadAmbientControl()?.enabled ?? this.cfg.enabled;
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

  /** Runtime on/off switch (req_ambient_toggle) — no restart needed. Persists. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      saveAmbientControl(on);
    } catch {
      /* best-effort: in-memory toggle still active */
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    if (!this.enabled) return []; // default OFF, or runtime-toggled OFF
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
