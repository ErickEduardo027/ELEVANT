export type GraphicTier = "FULL" | "LITE" | "STATIC";

export interface GraphicsSignals {
  reducedMotion: boolean;
  saveData: boolean;
  effectiveType?: string | null;
  webGLAvailable: boolean;
  deviceMemory?: number | null;
  viewportWidth: number;
}

const STATIC_CONNECTIONS = new Set(["slow-2g", "2g"]);

/**
 * Selects a rendering tier from already-detected browser signals.
 *
 * Keeping detection outside this pure function makes the result predictable
 * during SSR and straightforward to verify without a browser.
 */
export function selectGraphicTier(signals: GraphicsSignals): GraphicTier {
  const effectiveType = signals.effectiveType?.trim().toLowerCase();

  if (
    signals.reducedMotion ||
    signals.saveData ||
    !signals.webGLAvailable ||
    (effectiveType !== undefined && STATIC_CONNECTIONS.has(effectiveType))
  ) {
    return "STATIC";
  }

  if (
    effectiveType === "3g" ||
    !Number.isFinite(signals.viewportWidth) ||
    signals.viewportWidth < 1_024 ||
    (signals.deviceMemory !== undefined &&
      signals.deviceMemory !== null &&
      Number.isFinite(signals.deviceMemory) &&
      signals.deviceMemory <= 4)
  ) {
    return "LITE";
  }

  return "FULL";
}
