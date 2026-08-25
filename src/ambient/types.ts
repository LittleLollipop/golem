/**
 * Ambient subsystem types (req_sensor_camera_mic).
 *
 * The host (CameraMicSource) stays modality-agnostic (D4): it never names
 * "vision" or "audio" — that is the adapter's concern. Each captured sample is
 * processed LOCALLY (no cloud, no model call) and only its derived *features*
 * ever leave the adapter, never the raw pixels/samples.
 */

export type AmbientKind = "image" | "audio";

/** Locally-extracted features of a real captured sample. No raw bytes escape. */
export interface AmbientFeatures {
  /** Human-readable summary emitted as the signal observation text. */
  summary: string;
  /** image brightness hint 0..1 (coarse, byte-sampled) */
  brightness?: number;
  /** image dominant hue bucket: "warm" | "cool" | "neutral" | undefined */
  dominantHue?: string;
  /** audio energy hint 0..1 (RMS-derived where decodable) */
  energy?: number;
  durationMs?: number;
  width?: number;
  height?: number;
}

/** A real captured ambient sample (camera frame / mic clip), processed locally. */
export interface AmbientSample {
  kind: AmbientKind;
  /** device-clock time the frame/clip was captured */
  capturedAt: number;
  /** local file path the sample was read from / written to (never leaves disk) */
  localPath: string;
  features: AmbientFeatures;
}

/**
 * Platform capture adapter. The host decides WHAT to do with a sample; the
 * adapter decides HOW to obtain it. Two shipped adapters:
 *   - LocalSnapshotAdapter: reads real snapshot files dropped into a local dir.
 *   - NativeMediaAdapter:   shells out to platform tools (mac imagesnap/ffmpeg)
 *                           for genuine capture — only when explicitly enabled.
 */
export interface AmbientCaptureAdapter {
  readonly id: string;
  readonly description: string;
  /** Whether this adapter can capture right now (binary present, dir exists…). */
  isAvailable(): Promise<boolean>;
  capture(): Promise<AmbientSample[]>;
}
