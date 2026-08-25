/**
 * Ambient configuration — all knobs externalized (no hardcoding), opt-in by
 * default (req_capture_whitelist: minimal-by-default). Native capture and the
 * whole subsystem are OFF unless explicitly enabled via env.
 */

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
