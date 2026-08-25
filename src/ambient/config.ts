/**
 * Ambient configuration — all knobs externalized (no hardcoding), opt-in by
 * default (req_capture_whitelist: minimal-by-default). Native capture and the
 * whole subsystem are OFF unless explicitly enabled via env.
 *
 * Runtime toggle (req_ambient_toggle): an ambient-control.json file (path
 * overridable via FAKEREN_AMBIENT_CONTROL) can flip the master switch WITHOUT
 * a process restart. loadAmbientControl() overrides the env default when present.
 */

import * as fs from "node:fs";

export interface AmbientConfig {
  /** master switch for the whole camera/mic subsystem (default OFF) */
  enabled: boolean;
  /** allow shelling out to platform capture tools (default OFF) */
  nativeEnabled: boolean;
  /** local snapshot drop directory */
  dir: string;
  /** minimum ms between captures (throttle) */
  intervalMs: number;
  /** max samples surfaced per poll */
  maxSamplesPerPoll: number;
}

export function loadAmbientConfig(): AmbientConfig {
  return {
    enabled: process.env.FAKEREN_AMBIENT_ENABLE === "1",
    nativeEnabled: process.env.FAKEREN_AMBIENT_NATIVE === "1",
    dir: process.env.FAKEREN_AMBIENT_DIR ?? "./ambient",
    intervalMs: Number(process.env.FAKEREN_AMBIENT_INTERVAL_MS ?? 60000),
    maxSamplesPerPoll: Number(process.env.FAKEREN_AMBIENT_MAX ?? 1),
  };
}

export interface AmbientControl {
  enabled: boolean;
}

/** Path of the runtime-control file; overridable for tests / non-default deploys. */
export function ambientControlPath(): string {
  return process.env.FAKEREN_AMBIENT_CONTROL ?? "ambient-control.json";
}

/** Reads the runtime toggle if the control file exists; null otherwise. */
export function loadAmbientControl(): AmbientControl | null {
  try {
    const j = JSON.parse(fs.readFileSync(ambientControlPath(), "utf8"));
    if (typeof j?.enabled === "boolean") return { enabled: j.enabled };
  } catch {
    /* no control file → fall back to env */
  }
  return null;
}

/** Persists the runtime toggle so it survives restarts. */
export function saveAmbientControl(enabled: boolean): void {
  fs.writeFileSync(ambientControlPath(), JSON.stringify({ enabled }));
}
