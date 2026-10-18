import { Capacitor } from "@capacitor/core";

/** True when running inside a Capacitor Android/iOS shell. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): "ios" | "android" | "web" {
  try {
    const p = Capacitor.getPlatform();
    if (p === "ios" || p === "android") return p;
    return "web";
  } catch {
    return "web";
  }
}

/**
 * Warm native chrome: status bar, splash, keyboard — safe no-op on web.
 */
export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0A1628" });
  } catch {
    /* plugin optional */
  }
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }
}

/** Light haptic for primary actions on device. */
export async function nativeClickHaptic(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* ignore */
  }
}
