import { Capacitor, registerPlugin } from "@capacitor/core";

interface BeamScreenPlugin {
  captureOriginalBrightness(): Promise<{ brightness: number }>;
  setBrightness(options: { brightness: number }): Promise<{ brightness: number }>;
  restoreBrightness(): Promise<{ brightness: number }>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
}

const BeamScreen = registerPlugin<BeamScreenPlugin>("BeamScreen");

let wakeLock: WakeLockSentinel | null = null;
let browserBrightnessApplied = false;
let browserOriginalFilter = "";

function clampBrightness(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.08, Math.min(1, value));
}

export async function activateBeamScreen(brightness: number) {
  const safeBrightness = clampBrightness(brightness);

  if (Capacitor.isNativePlatform()) {
    await BeamScreen.captureOriginalBrightness().catch(() => ({ brightness: -1 }));
    await BeamScreen.setKeepAwake({ enabled: true }).catch(() => undefined);
    await BeamScreen.setBrightness({ brightness: safeBrightness }).catch(() => undefined);
    return;
  }

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (!browserBrightnessApplied) {
      browserOriginalFilter = root.style.filter || "";
      browserBrightnessApplied = true;
    }
    root.style.filter = `brightness(${Math.max(1, 0.86 + safeBrightness * 0.34).toFixed(3)})`;
  }

  if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
    try {
      wakeLock = await (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } }).wakeLock?.request("screen") ?? null;
    } catch {
      // Ignore browser wake lock failures.
    }
  }
}

export async function updateBeamScreenBrightness(brightness: number) {
  const safeBrightness = clampBrightness(brightness);

  if (Capacitor.isNativePlatform()) {
    await BeamScreen.setBrightness({ brightness: safeBrightness }).catch(() => undefined);
    return;
  }

  if (typeof document !== "undefined") {
    document.documentElement.style.filter = `brightness(${Math.max(1, 0.86 + safeBrightness * 0.34).toFixed(3)})`;
  }
}

export async function releaseBeamScreen() {
  if (Capacitor.isNativePlatform()) {
    await BeamScreen.restoreBrightness().catch(() => undefined);
    await BeamScreen.setKeepAwake({ enabled: false }).catch(() => undefined);
    return;
  }

  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      // Ignore browser wake lock release failures.
    }
    wakeLock = null;
  }

  if (typeof document !== "undefined" && browserBrightnessApplied) {
    document.documentElement.style.filter = browserOriginalFilter;
    browserBrightnessApplied = false;
    browserOriginalFilter = "";
  }
}
