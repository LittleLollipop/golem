/**
 * CameraMicSource — the real-sensory SignalSource (req_sensor_camera_mic).
 *
 * Implements the existing SignalSource contract (D4 modality-agnostic host), so
 * it slots straight into the SignalBus → SituationalChannel.perceive(idle) path.
 *
 * Per-source switches (req_capture_whitelist): camera (image) and mic (audio)
 * are independently toggleable, each backed by its own scoped adapter (so a
 * whitelist / kind filter applies per sense). Default is minimal capture — both
 * OFF unless explicitly enabled via env or the runtime control file
 * (req_ambient_toggle). Every captured sample is also pushed into the
 * AmbientBuffer, which #46/#47 wire into the L0 drift seed pool.
 *
 * Failures NEVER fabricate (req_degrade_no_fabricate): adapter unavailable or
 * capture throws → empty observations.
 */

import type { InstanceId } from "../types.js";
import type { SignalObservation, SignalSource } from "../bus/signal-bus.js";
import { AmbientBuffer } from "./ambient-buffer.js";
import { LocalSnapshotAdapter } from "./capture-adapter.js";
import type { AmbientCaptureAdapter, AmbientSample } from "./types.js";
import { loadAmbientConfig, loadAmbientControl, saveAmbientControl } from "./config.js";

export type AmbientSourceKind = "camera" | "mic";

export class CameraMicSource implements SignalSource {
  private readonly buffer = new AmbientBuffer();
  private lastCapture = 0;
  private readonly cfg = loadAmbientConfig();
  /** A single injected adapter (tests) drives both; otherwise two scoped ones. */
  private readonly cameraAdapter: AmbientCaptureAdapter;
  private readonly micAdapter: AmbientCaptureAdapter;
  private cameraOn: boolean;
  private micOn: boolean;

  constructor(adapter?: AmbientCaptureAdapter) {
    this.cameraAdapter =
      adapter ?? new LocalSnapshotAdapter(this.cfg.dir, { kinds: ["image"], whitelist: this.cfg.whitelist });
    this.micAdapter =
      adapter ?? new LocalSnapshotAdapter(this.cfg.dir, { kinds: ["audio"], whitelist: this.cfg.whitelist });
    const ctrl = loadAmbientControl();
    // control file overrides env defaults (req_ambient_toggle)
    this.cameraOn = ctrl?.camera ?? this.cfg.cameraEnabled;
    this.micOn = ctrl?.mic ?? this.cfg.micEnabled;
  }

  definition() {
    return {
      id: "camera_mic",
      name: "摄像头/麦克风",
      description: "真实感官接入：周期性捕获摄像头帧与环境声特征，全本地处理不出行（可插拔采集适配器，摄像头/麦克风独立开关）",
    };
  }

  /** The ambient stream buffer, exposed for L0 drift seed consumption (#46/#47). */
  getBuffer(): AmbientBuffer {
    return this.buffer;
  }

  /** Per-source runtime switch (req_capture_whitelist + req_ambient_toggle). */
  setSourceEnabled(source: AmbientSourceKind, on: boolean): void {
    if (source === "camera") this.cameraOn = on;
    else this.micOn = on;
    this.persist();
  }

  isSourceEnabled(source: AmbientSourceKind): boolean {
    return source === "camera" ? this.cameraOn : this.micOn;
  }

  /** Convenience: toggle both senses at once. */
  setEnabled(on: boolean): void {
    this.setSourceEnabled("camera", on);
    this.setSourceEnabled("mic", on);
  }

  isEnabled(): boolean {
    return this.cameraOn || this.micOn;
  }

  private persist(): void {
    try {
      saveAmbientControl({ camera: this.cameraOn, mic: this.micOn });
    } catch {
      /* best-effort: in-memory toggle still active */
    }
  }

  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    if (!this.cameraOn && !this.micOn) return []; // minimal-by-default
    const now = Date.now();
    if (now - this.lastCapture < this.cfg.intervalMs) return []; // throttle
    this.lastCapture = now;

    const gather = async (a: AmbientCaptureAdapter, on: boolean): Promise<AmbientSample[]> => {
      if (!on) return [];
      try {
        if (!(await a.isAvailable())) return [];
        return await a.capture();
      } catch {
        return []; // degrade, never fabricate
      }
    };

    const samples = (await gather(this.cameraAdapter, this.cameraOn)).concat(
      await gather(this.micAdapter, this.micOn),
    );

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
