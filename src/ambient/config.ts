/**
 * Ambient configuration — all knobs externalized (no hardcoding), opt-in by
 * default (req_capture_whitelist: minimal-by-default). Native capture and the
 * whole subsystem are OFF unless explicitly enabled via env.
 *
 * Per-source switches (req_capture_whitelist): camera and mic are independently
 * toggleable; a capture-scope whitelist bounds WHAT may be captured. A runtime
 * control file (ambient-control.json, path overridable via FAKEREN_AMBIENT_CONTROL)
 * flips either switch WITHOUT a restart (req_ambient_toggle).
 */

import * as fs from "node:fs";

export interface AmbientConfig {
  /** camera (image) capture switch — default OFF */
  cameraEnabled: boolean;
  /** mic (audio) capture switch — default OFF */
  micEnabled: boolean;
  /** allow shelling out to platform capture tools (default OFF) */
  nativeEnabled: boolean;
  /** run the independent background daemon timer (req_daemon_footprint). OFF → zero timer footprint (idle-only refresh). */
  daemonEnabled: boolean;
  /** local snapshot drop directory */
  dir: string;
  /** minimum ms between captures (throttle) */
  intervalMs: number;
  /** max samples surfaced per refresh (the "预算" sample cap) */
  maxSamplesPerPoll: number;
  /** wall-clock budget (ms) for a single refresh() — keeps background work cheap (req_async_precompute) */
  budgetMs: number;
  /** capture-scope whitelist: filename substrings that MUST match (empty = none) */
  whitelist: string[];
}

export function loadAmbientConfig(): AmbientConfig {
  return {
    cameraEnabled: process.env.FAKEREN_AMBIENT_CAMERA === "1",
    micEnabled: process.env.FAKEREN_AMBIENT_MIC === "1",
    nativeEnabled: process.env.FAKEREN_AMBIENT_NATIVE === "1",
    daemonEnabled: process.env.FAKEREN_AMBIENT_DAEMON !== "0",
    dir: process.env.FAKEREN_AMBIENT_DIR ?? "./ambient",
    intervalMs: Number(process.env.FAKEREN_AMBIENT_INTERVAL_MS ?? 60000),
    maxSamplesPerPoll: Number(process.env.FAKEREN_AMBIENT_MAX ?? 1),
    budgetMs: Number(process.env.FAKEREN_AMBIENT_BUDGET_MS ?? 2000),
    whitelist: (process.env.FAKEREN_AMBIENT_WHITELIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export interface AmbientControl {
  camera: boolean;
  mic: boolean;
}

/** Path of the runtime-control file; overridable for tests / non-default deploys. */
export function ambientControlPath(): string {
  return process.env.FAKEREN_AMBIENT_CONTROL ?? "ambient-control.json";
}

/** Reads the runtime toggle if the control file exists; null otherwise.
 *  Backward-compatible with the legacy `{ enabled }` shape. */
export function loadAmbientControl(): AmbientControl | null {
  try {
    const j = JSON.parse(fs.readFileSync(ambientControlPath(), "utf8"));
    if (typeof j?.camera === "boolean" && typeof j?.mic === "boolean") {
      return { camera: j.camera, mic: j.mic };
    }
    if (typeof j?.enabled === "boolean") return { camera: j.enabled, mic: j.enabled };
  } catch {
    /* no control file → fall back to env */
  }
  return null;
}

/** Persists the runtime toggle so it survives restarts. */
export function saveAmbientControl(c: AmbientControl): void {
  fs.writeFileSync(ambientControlPath(), JSON.stringify(c));
}
