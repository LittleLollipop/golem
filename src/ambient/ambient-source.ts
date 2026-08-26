/**
 * CameraMicSource — the real-sensory SignalSource (req_sensor_camera_mic).
 *
 * Implements the existing SignalSource contract (D4 modality-agnostic host), so
 * it slots straight into the SignalBus → SituationalChannel.perceive(idle) path.
 *
 * Async precompute (req_async_precompute): the costly capture + feature
 * extraction lives in refresh(), which runs in the BACKGROUND (a timer daemon
 * and/or the dsh idle phase) and fills a ready cache plus the AmbientBuffer.
 * The SignalSource contract method poll() is a PURE foreground fetch of that
 * cache — it NEVER captures — so sensory processing can never block the main
 * turn's critical path. refresh() is budget-bounded (budgetMs) so the
 * background work itself stays cheap and predictable.
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
import { BackgroundTaskLog, SCHEDULER_GLOBAL_INSTANCE } from "../scheduler/background-log.js";

export type AmbientSourceKind = "camera" | "mic";

export class CameraMicSource implements SignalSource {
  private readonly buffer = new AmbientBuffer();
  /** Ready cache produced by refresh() — the "前台取" store. poll() never captures. */
  private readonly precomputed: SignalObservation[] = [];
  private lastRefreshedAt = 0;
  private lastRefreshMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cfg = loadAmbientConfig();
  /** A single injected adapter (tests) drives both; otherwise two scoped ones. */
  private readonly cameraAdapter: AmbientCaptureAdapter;
  private readonly micAdapter: AmbientCaptureAdapter;
  private cameraOn: boolean;
  private micOn: boolean;

  constructor(adapter?: AmbientCaptureAdapter, private readonly log?: BackgroundTaskLog) {
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
      description: "真实感官接入：周期性捕获摄像头帧与环境声特征，全本地处理不出行（可插拔采集适配器，摄像头/麦克风独立开关，异步预算不拖主回合）",
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
    this.reconcileDaemon(); // footprint follows enabled state (req_daemon_footprint)
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

  // ── Async precompute (req_async_precompute) ────────────────────────────────

  /**
   * BACKGROUND compute: capture + extract features + push buffer + refresh the
   * ready cache. Budget-bounded by budgetMs so it never hogs the background
   * phase. Call this from a timer (start) and/or the dsh idle phase — NOT from
   * the main turn.
   */
  async refresh(): Promise<number> {
    if (!this.cameraOn && !this.micOn) {
      this.precomputed.length = 0;
      return 0;
    }
    // throttle: don't recompute more often than intervalMs
    const now = Date.now();
    if (now - this.lastRefreshedAt < this.cfg.intervalMs) return 0;

    const start = Date.now();
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

    this.precomputed.length = 0;
    let n = 0;
    for (const s of samples.slice(0, this.cfg.maxSamplesPerPoll)) {
      if (Date.now() - start > this.cfg.budgetMs) break; // 预算上限：超时就停
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
      this.precomputed.push(obs);
      n++;
    }
    this.lastRefreshMs = Date.now() - start;
    this.lastRefreshedAt = Date.now();
    // 后台调度日志：记录"拉了多少真实样本"（req_background_task_log）。
    // 仅在实际执行了刷新周期后落日志（被节流的早返回不算一次调度）。
    if (this.log) this.log.refresh(SCHEDULER_GLOBAL_INSTANCE, n);
    return n;
  }

  /**
   * FOREGROUND fetch — the SignalSource contract method. PURE: never captures,
   * never blocks. Returns whatever refresh() has precomputed (req_async_precompute).
   */
  async poll(_instanceId: InstanceId): Promise<SignalObservation[]> {
    return this.precomputed.slice();
  }

  /** Start the background daemon timer (true async precompute). Unref'd so it
   *  never keeps the process alive on its own. No-ops when the daemon is disabled
   *  by config, or when no sense is enabled — keeping the footprint at zero
   *  (req_daemon_footprint: 慢节奏即设计). */
  start(intervalMs: number = this.cfg.intervalMs): void {
    this.stop();
    if (!this.cfg.daemonEnabled) return; // 0 footprint by config
    if (!this.isEnabled()) return; // nothing to sense → no timer
    if (intervalMs > 0) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, intervalMs);
      this.timer.unref?.();
    }
  }

  /** Keep the daemon timer in sync with the enabled state (req_daemon_footprint). */
  private reconcileDaemon(): void {
    if (this.isEnabled()) this.start();
    else this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  lastRefreshed(): number {
    return this.lastRefreshedAt;
  }

  /** Observable resource footprint (req_daemon_footprint). Lets ops/CLI inspect
   *  exactly what the daemon costs before trusting it. */
  footprint(): {
    running: boolean;
    daemonEnabled: boolean;
    cameraOn: boolean;
    micOn: boolean;
    intervalMs: number;
    budgetMs: number;
    maxSamplesPerPoll: number;
    lastRefreshMs: number;
    lastSampleCount: number;
    lastRefreshedAt: number;
  } {
    return {
      running: this.isRunning(),
      daemonEnabled: this.cfg.daemonEnabled,
      cameraOn: this.cameraOn,
      micOn: this.micOn,
      intervalMs: this.cfg.intervalMs,
      budgetMs: this.cfg.budgetMs,
      maxSamplesPerPoll: this.cfg.maxSamplesPerPoll,
      lastRefreshMs: this.lastRefreshMs,
      lastSampleCount: this.precomputed.length,
      lastRefreshedAt: this.lastRefreshedAt,
    };
  }
}
